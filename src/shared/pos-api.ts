export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version'
} as const

export interface PosApi {
  app: {
    getVersion(): Promise<string>
  }
}
