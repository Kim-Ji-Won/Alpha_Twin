// Bottom tabs (Expo Router: app/(tabs)/)
export const TABS = [
  { name: 'home',      label: 'Home',      screen: 'MarketBrain' },
  { name: 'discover',  label: 'Discover',  screen: 'Discover' },
  { name: 'twin',      label: 'Twin',      screen: 'Watchlist' },
  { name: 'portfolio', label: 'Portfolio', screen: 'PortfolioXRay' },
  { name: 'ai',        label: 'AI',        screen: 'AIAnalyst' },
] as const;

// Route map (suggested Expo Router paths)
export const ROUTES = {
  splash: '/',
  onboarding: '/onboarding',            // 3 pages, pager
  login: '/auth/login',
  interests: '/auth/interests',         // industry + stock picks (steps)
  home: '/(tabs)/home',
  discover: '/(tabs)/discover',
  watchlist: '/(tabs)/twin',
  portfolio: '/(tabs)/portfolio',
  ai: '/(tabs)/ai',
  companyTwin: '/company/[symbol]',
  scenarioInput: '/scenario/new',       // accepts ?symbol= or ?portfolio=1
  scenarioResult: '/scenario/[id]',
  thesis: '/thesis/[id]',
  thesisNew: '/thesis/new',
  thesisHistory: '/thesis/[id]/history',
  managementTrust: '/company/[symbol]/management',
  aiEvidence: '/ai/evidence/[answerId]',
  sourceDetail: '/source/[id]',         // filing / news original
  notifications: '/notifications',
  portfolioAdd: '/portfolio/add',
  profile: '/profile',
  settings: '/settings',
  legal: '/legal/[doc]',                // terms | privacy | disclaimer
} as const;

// Required flows — every arrow must be a working navigation:
// MarketBrain -> CompanyTwin | Notifications | ScenarioInput
// CompanyTwin -> ScenarioInput | Thesis | ManagementTrust | network fullscreen
// PortfolioXRay -> ScenarioInput | risk detail
// Discover -> CompanyTwin
// Notification -> CompanyTwin | Thesis
// AIAnalyst -> aiEvidence -> sourceDetail
// Onboarding -> login -> interests -> portfolioAdd(optional) -> home
