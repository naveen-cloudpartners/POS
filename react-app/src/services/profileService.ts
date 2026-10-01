import API_BASE, { apiFetch } from './api';

export interface PersonalProfile {
  name: string;
  phone: string;
  email: string;
  role: string;
  avatar_version: string;
}
interface ProfileResponse { success: boolean; profile: PersonalProfile }
export const profilePhotoUrl = (version: string) => `${API_BASE}/profile/me/photo?v=${encodeURIComponent(version)}`;
export async function getPersonalProfile() {
  return (await apiFetch<ProfileResponse>('/profile/me')).profile;
}
export async function savePersonalProfile(name: string, phone: string) {
  return (await apiFetch<ProfileResponse>('/profile/me', { method: 'PUT', body: { name, phone } })).profile;
}
export async function uploadProfilePhoto(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP photo.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Photo must be 2 MB or smaller.');
  const imageData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read your photo.'));
    reader.readAsDataURL(file);
  });
  return (await apiFetch<ProfileResponse>('/profile/me/photo', { method: 'POST', body: { imageData } })).profile;
}
export async function removeProfilePhoto() {
  return (await apiFetch<ProfileResponse>('/profile/me/photo', { method: 'DELETE' })).profile;
}
