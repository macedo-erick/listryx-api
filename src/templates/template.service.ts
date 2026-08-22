import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { eq } from 'drizzle-orm';
import type { Counter } from 'prom-client';

import { type PageResponse, pageOf } from '../common/page-response';
import { DATABASE, type Database } from '../database/db';
import { listTemplate, listTemplateItem } from '../database/schema';
import { TEMPLATES_SAVED } from '../metrics/metrics.module';
import type {
  TemplateQuery,
  TemplateResponse,
  TemplateSummaryResponse,
  UpsertTemplateRequest,
} from './dto';
import { TemplateRepository } from './template.repository';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly templates: TemplateRepository,
    @InjectMetric(TEMPLATES_SAVED) private readonly templatesSaved: Counter<'source'>,
  ) {}

  async findAll(
    ownerId: string,
    query: TemplateQuery,
  ): Promise<PageResponse<TemplateSummaryResponse>> {
    const { content, totalElements } = await this.templates.findSummaries(ownerId, query);

    return pageOf(content, query.page, query.size, totalElements);
  }

  async findOne(ownerId: string, templateId: string): Promise<TemplateResponse> {
    const summary = await this.templates.findSummary(ownerId, templateId);

    if (summary === undefined) {
      throw new NotFoundException(`Template not found: ${templateId}`);
    }

    return { ...summary, items: await this.templates.findItems(templateId) };
  }

  async create(ownerId: string, request: UpsertTemplateRequest): Promise<TemplateResponse> {
    const templateId = randomUUID();

    await this.db.transaction(async (tx) => {
      await tx.insert(listTemplate).values({ id: templateId, ownerId, name: request.name });
      await this.writeItems(tx, templateId, request);
    });

    this.templatesSaved.labels('scratch').inc();
    this.logger.log({
      event: 'template.created',
      templateId,
      itemCount: request.items.length,
    });

    return this.findOne(ownerId, templateId);
  }

  async replace(
    ownerId: string,
    templateId: string,
    request: UpsertTemplateRequest,
  ): Promise<TemplateResponse> {
    if (!(await this.templates.exists(ownerId, templateId))) {
      throw new NotFoundException(`Template not found: ${templateId}`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(listTemplate)
        .set({ name: request.name })
        .where(eq(listTemplate.id, templateId));
      await tx.delete(listTemplateItem).where(eq(listTemplateItem.templateId, templateId));
      await this.writeItems(tx, templateId, request);
    });

    this.logger.log({
      event: 'template.updated',
      templateId,
      itemCount: request.items.length,
    });

    return this.findOne(ownerId, templateId);
  }

  async remove(ownerId: string, templateId: string): Promise<void> {
    if (!(await this.templates.delete(ownerId, templateId))) {
      throw new NotFoundException(`Template not found: ${templateId}`);
    }

    this.logger.log({ event: 'template.deleted', templateId });
  }

  private async writeItems(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    templateId: string,
    request: UpsertTemplateRequest,
  ): Promise<void> {
    if (request.items.length === 0) {
      return;
    }

    await tx.insert(listTemplateItem).values(
      request.items.map((item, index) => ({
        id: randomUUID(),
        templateId,
        text: item.text,
        defaultQuantity: item.defaultQuantity ?? null,
        sortOrder: index,
      })),
    );
  }
}
