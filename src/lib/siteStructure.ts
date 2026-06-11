export const NAV_HEIGHT = 64;

export const SECTION_STAGE_CLASS = "section-stage";
export const SECTION_STAGE_SELECTOR = `section.${SECTION_STAGE_CLASS}`;

export const NAV_CHAPTERS = ["overview", "system", "evolve", "everywhere"] as const;
export const DOWNLOAD_CHAPTER = "download";
export const CHAPTERS = [...NAV_CHAPTERS, DOWNLOAD_CHAPTER] as const;

export type NavChapterId = (typeof NAV_CHAPTERS)[number];
export type ChapterId = (typeof CHAPTERS)[number];
