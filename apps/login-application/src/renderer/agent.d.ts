interface Window {
  loginApplication: {
    addCurrentDevice(input: { serverUrl: string; name: string; password: string }): Promise<{ ok: boolean; error?: string }>
    onStatus(listener: (status: string) => void): () => void
  }
}
