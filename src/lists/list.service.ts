import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { eq } from 'drizzle-orm';
import type { Counter } from 'prom-client';

import { normalizeText } from '../common/normalize';
import { type PageResponse, pageOf } from '../common/page-response';
import { DATABASE, type Database } from '../database/db';
import { list, listItem, listTemplate, listTemplateItem } from '../database/schema';
import { InsightRepository } from '../insights/insight.repository';
import { LISTS_CREATED, TEMPLATES_SAVED } from '../metrics/metrics.module';
import { TemplateRepository } from '../templates/template.repository';
import type {
  CreateItemRequest,
  CreateListRequest,
  ListQuery,
  ListResponse,
  ListSummaryResponse,
  ReorderItemsRequest,
  SaveAsTemplateRequest,
  UpdateItemRequest,
} from './dto';
import { ListRepository } from './list.repository';

@Injectable()
export class ListService {
  private readonly logger = new Logger(ListService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly lists: ListRepository,
    private readonly templates: TemplateRepository,
    private readonly insights: InsightRepository,
    @InjectMetric(LISTS_CREATED) private readonly listsCreated: Counter<'source'>,
    @InjectMetric(TEMPLATES_SAVED) private readonly templatesSaved: Counter<'source'>,
  ) {}

  async findAll(ownerId: string, query: ListQuery): Promise<PageResponse<ListSummaryResponse>> {
    const { content, totalElements } = await this.lists.findSummaries(ownerId, query);

    return pageOf(content, query.page, query.size, totalElements);
  }

  async findOne(ownerId: string, listId: string): Promise<ListResponse> {
    const summary = await this.lists.findSummary(ownerId, listId);

    if (summary === undefined) {
      throw new NotFoundException(`List not found: ${listId}`);
    }

    return { ...summary, items: await this.lists.findItems(listId) };
  }

  async create(ownerId: string, request: CreateListRequest): Promise<ListResponse> {
    const listId = randomUUID();
    const templateId = request.templateId;

    if (templateId === undefined) {
      await this.db.insert(list).values({ id: listId, ownerId, name: request.name });
      this.listsCreated.labels('scratch').inc();
      this.logger.log({ event: 'list.created', listId, source: 'scratch' });

      return this.findOne(ownerId, listId);
    }

    const templateItems = await this.templates.findItemsForOwner(ownerId, templateId);

    if (templateItems === null) {
      throw new NotFoundException(`Template not found: ${templateId}`);
    }

    const prices = await this.insights.lastKnownPrices(
      ownerId,
      templateItems.map((item) => normalizeText(item.text)),
    );

    await this.db.transaction(async (tx) => {
      await tx.insert(list).values({ id: listId, ownerId, name: request.name, templateId });

      if (templateItems.length > 0) {
        await tx.insert(listItem).values(
          templateItems.map((item, index) => ({
            id: randomUUID(),
            listId,
            text: item.text,
            quantity: item.defaultQuantity,
            unitPrice: prices.get(normalizeText(item.text)) ?? null,
            sortOrder: index,
          })),
        );
      }
    });

    this.listsCreated.labels('template').inc();
    this.logger.log({
      event: 'list.created',
      listId,
      source: 'template',
      templateId,
      itemCount: templateItems.length,
    });

    return this.findOne(ownerId, listId);
  }

  async rename(ownerId: string, listId: string, name: string): Promise<ListResponse> {
    if (!(await this.lists.rename(ownerId, listId, name))) {
      throw new NotFoundException(`List not found: ${listId}`);
    }

    this.logger.log({ event: 'list.renamed', listId });

    return this.findOne(ownerId, listId);
  }

  async setStatus(
    ownerId: string,
    listId: string,
    status: 'open' | 'closed',
  ): Promise<ListResponse> {
    if (!(await this.lists.setStatus(ownerId, listId, status))) {
      throw new NotFoundException(`List not found: ${listId}`);
    }

    this.logger.log({ event: status === 'closed' ? 'list.closed' : 'list.reopened', listId });

    return this.findOne(ownerId, listId);
  }

  async remove(ownerId: string, listId: string): Promise<void> {
    if (!(await this.lists.delete(ownerId, listId))) {
      throw new NotFoundException(`List not found: ${listId}`);
    }

    this.logger.log({ event: 'list.deleted', listId });
  }

  async addItem(
    ownerId: string,
    listId: string,
    request: CreateItemRequest,
  ): Promise<ListResponse> {
    await this.requireList(ownerId, listId);

    const itemId = randomUUID();

    await this.lists.insertItem({
      id: itemId,
      listId,
      text: request.text,
      quantity: request.quantity ?? null,
      unitPrice: request.unitPrice ?? null,
      sortOrder: await this.lists.nextSortOrder(listId),
    });

    this.logger.log({ event: 'list_item.added', listId, itemId });

    return this.findOne(ownerId, listId);
  }

  async updateItem(
    ownerId: string,
    listId: string,
    itemId: string,
    request: UpdateItemRequest,
  ): Promise<ListResponse> {
    await this.requireList(ownerId, listId);

    const values = {
      ...(request.text !== undefined ? { text: request.text } : {}),
      ...(request.quantity !== undefined ? { quantity: request.quantity } : {}),
      ...(request.unitPrice !== undefined ? { unitPrice: request.unitPrice } : {}),
      ...(request.checked !== undefined ? { checked: request.checked } : {}),
    };

    if (!(await this.lists.updateItem(listId, itemId, values))) {
      throw new NotFoundException(`Item not found: ${itemId}`);
    }

    this.logger.log({ event: 'list_item.updated', listId, itemId, fields: Object.keys(values) });

    return this.findOne(ownerId, listId);
  }

  async removeItem(ownerId: string, listId: string, itemId: string): Promise<void> {
    await this.requireList(ownerId, listId);

    if (!(await this.lists.deleteItem(listId, itemId))) {
      throw new NotFoundException(`Item not found: ${itemId}`);
    }

    this.logger.log({ event: 'list_item.deleted', listId, itemId });
  }

  async reorderItems(
    ownerId: string,
    listId: string,
    request: ReorderItemsRequest,
  ): Promise<ListResponse> {
    await this.requireList(ownerId, listId);

    const known = await this.lists.itemIdsOf(listId, request.itemIds);
    const existing = await this.lists.findItems(listId);

    if (known.length !== request.itemIds.length || known.length !== existing.length) {
      throw new NotFoundException('The ordering must name every item in this list, and no others');
    }

    await this.lists.reorderItems(listId, request.itemIds);
    this.logger.log({ event: 'list.items_reordered', listId, itemCount: request.itemIds.length });

    return this.findOne(ownerId, listId);
  }

  async saveAsTemplate(
    ownerId: string,
    listId: string,
    request: SaveAsTemplateRequest,
  ): Promise<string> {
    await this.requireList(ownerId, listId);

    const items = await this.lists.findItems(listId);
    const existingId = request.templateId;

    if (existingId !== undefined && !(await this.templates.exists(ownerId, existingId))) {
      throw new NotFoundException(`Template not found: ${existingId}`);
    }

    const templateId = existingId ?? randomUUID();

    await this.db.transaction(async (tx) => {
      if (existingId === undefined) {
        await tx.insert(listTemplate).values({ id: templateId, ownerId, name: request.name });
      } else {
        await tx
          .update(listTemplate)
          .set({ name: request.name })
          .where(eq(listTemplate.id, templateId));
        await tx.delete(listTemplateItem).where(eq(listTemplateItem.templateId, templateId));
      }

      if (items.length > 0) {
        await tx.insert(listTemplateItem).values(
          items.map((item, index) => ({
            id: randomUUID(),
            templateId,
            text: item.text,
            defaultQuantity: item.quantity,
            sortOrder: index,
          })),
        );
      }
    });

    this.templatesSaved.labels('list').inc();
    this.logger.log({
      event: 'template.saved_from_list',
      templateId,
      listId,
      itemCount: items.length,
      replaced: existingId !== undefined,
    });

    return templateId;
  }

  private async requireList(ownerId: string, listId: string): Promise<void> {
    if (!(await this.lists.exists(ownerId, listId))) {
      throw new NotFoundException(`List not found: ${listId}`);
    }
  }
}
