// Re-export from context so components always share the same settings state
export { useSettings, SettingsProvider } from '../store/SettingsContext'
export type { ArcMode, RecentConnection, Settings } from '../store/SettingsContext'
