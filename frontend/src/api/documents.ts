import { api } from './client';

export interface DocumentDto {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotResponse {
  /** Base64-encoded CRDT state from backend */
  crdtState: string | number[] | null;
  version: number;
}

export type PermissionLevel = 'READ' | 'WRITE' | 'OWNER';

export interface PermissionDto {
  id: string;
  documentId: string;
  userId: string;
  userEmail: string;
  permission: PermissionLevel;
}

export async function listDocuments(): Promise<DocumentDto[]> {
  return api<DocumentDto[]>('/api/documents');
}

export async function createDocument(title: string): Promise<DocumentDto> {
  return api<DocumentDto>('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function getDocument(documentId: string): Promise<DocumentDto> {
  return api<DocumentDto>(`/api/documents/${documentId}`);
}

export async function renameDocument(documentId: string, title: string): Promise<DocumentDto> {
  return api<DocumentDto>(`/api/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function getSnapshot(documentId: string): Promise<SnapshotResponse> {
  return api<SnapshotResponse>(`/api/documents/${documentId}/snapshot`);
}

export async function uploadSnapshot(documentId: string, crdtState: Uint8Array): Promise<{ version: number }> {
  const base = import.meta.env.VITE_API_URL || '';
  const token = localStorage.getItem('token');
  const res = await fetch(`${base}/api/documents/${documentId}/snapshot`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: crdtState as unknown as BodyInit,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json();
}

export async function listPermissions(documentId: string): Promise<PermissionDto[]> {
  return api<PermissionDto[]>(`/api/documents/${documentId}/permissions`);
}

export async function grantPermissionByEmail(
  documentId: string,
  userEmail: string,
  permission: Exclude<PermissionLevel, 'OWNER'>
): Promise<PermissionDto> {
  return api<PermissionDto>(`/api/documents/${documentId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ userEmail, permission }),
  });
}

export async function revokePermission(documentId: string, userId: string): Promise<void> {
  await api<void>(`/api/documents/${documentId}/permissions/${userId}`, {
    method: 'DELETE',
  });
}
