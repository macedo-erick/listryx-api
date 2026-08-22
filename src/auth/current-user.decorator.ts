import { type ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const sub = request.user?.sub;

  if (sub === undefined) {
    throw new UnauthorizedException();
  }

  return sub;
});
