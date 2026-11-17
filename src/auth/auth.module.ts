import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { RateLimiterService } from "./rate-limiter.service";
import { TokenService } from "./token.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, RateLimiterService],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
