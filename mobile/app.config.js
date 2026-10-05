module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_IPHONE_READINESS !== 'true') return config;
  if (process.env.EAS_BUILD_PROFILE !== 'iphone-readiness') {
    throw new Error('Installation-only mode requires the iphone-readiness build profile.');
  }
  return {
    ...config,
    runtimeVersion: 'iphone-readiness-1',
    updates: { ...config.updates, enabled: false },
    ios: { ...config.ios, associatedDomains: [] },
  };
};
