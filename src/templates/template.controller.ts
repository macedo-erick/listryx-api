import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import type { PageResponse } from '../common/page-response';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import {
  type TemplateQuery,
  type TemplateResponse,
  type TemplateSummaryResponse,
  type UpsertTemplateRequest,
  templateQuerySchema,
  upsertTemplateSchema,
} from './dto';
import { TemplateService } from './template.service';

@Controller('templates')
@UseGuards(JwtGuard)
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get()
  findAll(
    @CurrentUser() ownerId: string,
    @Query(zodQuery(templateQuerySchema)) query: TemplateQuery,
  ): Promise<PageResponse<TemplateSummaryResponse>> {
    return this.templates.findAll(ownerId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateResponse> {
    return this.templates.findOne(ownerId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() ownerId: string,
    @Body(zodBody(upsertTemplateSchema)) request: UpsertTemplateRequest,
  ): Promise<TemplateResponse> {
    return this.templates.create(ownerId, request);
  }

  @Put(':id')
  replace(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(upsertTemplateSchema)) request: UpsertTemplateRequest,
  ): Promise<TemplateResponse> {
    return this.templates.replace(ownerId, id, request);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.templates.remove(ownerId, id);
  }
}
