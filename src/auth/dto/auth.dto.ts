import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Invalid email format" })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: "SuperSecret123!", minLength: 8 })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters long" })
  password!: string;

  @ApiPropertyOptional({ example: "Jane Doe" })
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: "SuperSecret123!" })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional({ example: "3fa85f64-5717-4562-b3fc-2c963f66afa6" })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description: "JWT refresh token. Omit it from browsers: the HttpOnly cookie is used instead.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description: "JWT refresh token to invalidate. Omit it from browsers: the cookie is used.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: "Email verification token" })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: "Password reset token" })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: "NewSuperSecret456!", minLength: 8 })
  @IsString()
  @MinLength(8, { message: "New password must be at least 8 characters long" })
  newPassword!: string;
}
