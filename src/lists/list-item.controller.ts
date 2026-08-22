import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type CreateItemRequest,
  type ListResponse,
  type ReorderItemsRequest,
  type UpdateItemRequest,
  createItemSchema,
  reorderItemsSchema,
  updateItemSchema,
} from './dto';
import { ListService } from './list.service';

@Controller('lists/:listId/items')
@UseGuards(JwtGuard)
export class ListItemController {
  constructor(private readonly lists: ListService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(
    @CurrentUser() ownerId: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body(zodBody(createItemSchema)) request: CreateItemRequest,
  ): Promise<ListResponse> {
    return this.lists.addItem(ownerId, listId, request);
  }

  @Put('order')
  reorder(
    @CurrentUser() ownerId: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body(zodBody(reorderItemsSchema)) request: ReorderItemsRequest,
  ): Promise<ListResponse> {
    return this.lists.reorderItems(ownerId, listId, request);
  }

  @Patch(':itemId')
  update(
    @CurrentUser() ownerId: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zodBody(updateItemSchema)) request: UpdateItemRequest,
  ): Promise<ListResponse> {
    return this.lists.updateItem(ownerId, listId, itemId, request);
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() ownerId: string,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.lists.removeItem(ownerId, listId, itemId);
  }
}
