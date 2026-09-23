// v58.13.132ba — Metro blockList for the diagnostic strip build.
//
// Why: `.132ba` strips 10 native modules (expo-camera / -location /
// -notifications / -secure-store / -local-authentication /
// -clipboard / -image-picker / -document-picker / -file-system /
// -web-browser) from `package.json` to isolate the Android launch
// crash. The `_archived_v58_pre_rebuild/` tree (pre-rebuild v58
// source, retained for reference) contains static `import` sites
// for every one of those stripped packages, so Metro walks the
// archive during bundling and fails to resolve. Excluding the
// archive here fixes the bundler without touching the archive
// itself, so we can restore modules in .132bb+ builds without
// clobbering historical source.
//
// The `_archived_m5_wrong_approach/` tree is excluded for the same
// reason (defensive — future strips may re-hit the same pattern).
//
// If a future ship wants to prune these archives entirely (rather
// than exclude them), delete both directories and remove this
// config file — Expo's default Metro config is fine.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// v58.13.132ba (retry #2) — portable regex. The previous attempt
// used `path.join(__dirname, '_archived_')` which baked the LOCAL
// absolute path into the pattern; on the EAS runner __dirname is
// under `/home/expo/workingdir/...` so the pattern never matched
// and Metro still walked the archive. This form matches any file
// under a top-level or nested `_archived_*` directory regardless
// of the host filesystem layout.
const archivePattern = /(^|\/)_archived_[^/]*\/.*/;

const existing = config.resolver.blockList;
if (existing) {
  const asArray = Array.isArray(existing) ? existing : [existing];
  config.resolver.blockList = [...asArray, archivePattern];
} else {
  config.resolver.blockList = archivePattern;
}

module.exports = config;
