import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';

import { CONFIG, type Config, jwksUri } from '../config';

export interface AuthenticatedUser {
  readonly sub: string;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);
  private readonly keys: JWTVerifyGetKey;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.keys = createRemoteJWKSet(jwksUri(config));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request.headers.authorization);

    if (token === null) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.KEYCLOAK_ISSUER_URI,
      });

      if (typeof payload.sub !== 'string' || payload.sub === '') {
        throw new UnauthorizedException('Token carries no subject');
      }

      request.user = { sub: payload.sub };

      return true;
    } catch (error) {
      this.logger.warn(
        `Rejected a bearer token: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const [scheme, ...rest] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || rest.length !== 1) {
    return null;
  }

  return rest[0] ?? null;
}
