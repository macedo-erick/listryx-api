import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { zodQuery } from '../common/zod-validation.pipe';
import {
  type ItemPricePointResponse,
  type ItemPricesQuery,
  type ListTotalPointResponse,
  type ListTotalsQuery,
  type PricedItemResponse,
  itemPricesQuerySchema,
  listTotalsQuerySchema,
} from './dto';
import { InsightRepository } from './insight.repository';

@Controller('insights')
@UseGuards(JwtGuard)
export class InsightController {
  constructor(private readonly insights: InsightRepository) {}

  @Get('items')
  items(@CurrentUser() ownerId: string): Promise<PricedItemResponse[]> {
    return this.insights.pricedItems(ownerId);
  }

  @Get('item-prices')
  itemPrices(
    @CurrentUser() ownerId: string,
    @Query(zodQuery(itemPricesQuerySchema)) query: ItemPricesQuery,
  ): Promise<ItemPricePointResponse[]> {
    return this.insights.itemPrices(ownerId, query.text);
  }

  @Get('list-totals')
  listTotals(
    @CurrentUser() ownerId: string,
    @Query(zodQuery(listTotalsQuerySchema)) query: ListTotalsQuery,
  ): Promise<ListTotalPointResponse[]> {
    return this.insights.listTotals(ownerId, query.from, query.to);
  }
}
