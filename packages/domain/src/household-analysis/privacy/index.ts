export * from './ViewerContext'
// M-B spec §4.1: Query adapter がプライバシー 3 段階を適用するため公開 API へ昇格
// @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.1
export { isVisibleAsDetail, toListItems } from './applyPrivacyFilter'
