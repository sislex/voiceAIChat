export interface DevStandAccessRequest { projectId: string; standId: string; port?: number }
export interface DevStandAccessResponse { url: string; expiresAt: number }
