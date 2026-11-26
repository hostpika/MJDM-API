import { Module } from "@nestjs/common";
import { SiteContentService } from "./site-content.service";

/** One shared instance, so an admin's edit is seen by everything that reads the site content. */
@Module({ providers: [SiteContentService], exports: [SiteContentService] })
export class SiteModule {}
