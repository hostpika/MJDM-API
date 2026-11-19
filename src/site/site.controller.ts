import { Body, Controller, Get, Header, Put, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminService } from "../admin/admin.service";
import { AdminGuard, type AdminRequest } from "../admin/admin.guard";
import { SiteContentService } from "./site-content.service";

@ApiTags("Site content")
@Controller("v1")
export class SiteController {
  constructor(
    private readonly site: SiteContentService,
    private readonly admin: AdminService
  ) {}

  /** Public: what the website renders (downloads, pricing, announcement, text overrides). */
  @Get("site/content")
  @Header("Cache-Control", "public, max-age=30, stale-while-revalidate=300")
  @ApiOperation({ summary: "Public website content" })
  async publicContent() {
    return this.site.get();
  }

  @Get("admin/site/content")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Admin: current website content" })
  async adminContent() {
    return this.site.get();
  }

  @Put("admin/site/content")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Admin: replace the website content (validated, audited)" })
  async update(@Body() body: unknown, @Req() req: AdminRequest) {
    const email = req.admin?.sub ?? "admin";
    const before = (await this.site.get()).content.release.version;
    const saved = await this.site.set(body, email);
    await this.admin.recordAudit(
      email,
      "site.content.update",
      "site-content",
      "site",
      { versionBefore: before, versionAfter: saved.content.release.version },
      req.ip
    );
    return saved;
  }
}
