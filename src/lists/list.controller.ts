import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import type { PageResponse } from '../common/page-response';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import {
  type CreateListRequest,
  type ListQuery,
  type ListResponse,
  type ListSummaryResponse,
  type RenameListRequest,
  type SaveAsTemplateRequest,
  createListSchema,
  listQuerySchema,
  renameListSchema,
  saveAsTemplateSchema,
} from './dto';
import { ListService } from './list.service';

@Controller('lists')
@UseGuards(JwtGuard)
export class ListController {
  constructor(private readonly lists: ListService) {}

  @Get()
  findAll(
    @CurrentUser() ownerId: string,
    @Query(zodQuery(listQuerySchema)) query: ListQuery,
  ): Promise<PageResponse<ListSummaryResponse>> {
    return this.lists.findAll(ownerId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListResponse> {
    return this.lists.findOne(ownerId, id);
  }

  @Post()
  create(
    @CurrentUser() ownerId: string,
    @Body(zodBody(createListSchema)) request: CreateListRequest,
  ): Promise<ListResponse> {
    return this.lists.create(ownerId, request);
  }

  @Patch(':id')
  rename(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(renameListSchema)) request: RenameListRequest,
  ): Promise<ListResponse> {
    return this.lists.rename(ownerId, id, request.name);
  }

  @Post(':id/close')
  close(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListResponse> {
    return this.lists.setStatus(ownerId, id, 'closed');
  }

  @Post(':id/reopen')
  reopen(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListResponse> {
    return this.lists.setStatus(ownerId, id, 'open');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.lists.remove(ownerId, id);
  }

  @Post(':id/save-as-template')
  @HttpCode(HttpStatus.CREATED)
  async saveAsTemplate(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(saveAsTemplateSchema)) request: SaveAsTemplateRequest,
  ): Promise<{ templateId: string }> {
    return { templateId: await this.lists.saveAsTemplate(ownerId, id, request) };
  }
}
