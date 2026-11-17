import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  /**
   * Enforces rate limit for a specific key (e.g. IP + action).
   * Throws 429 Too Many Requests if limit is exceeded.
   */
  check(key: string, maxRequests = 5, windowMs = 60000): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return;
    }

    if (bucket.count >= maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    bucket.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clearAll(): void {
    this.buckets.clear();
  }
}
