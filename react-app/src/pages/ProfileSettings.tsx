import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Save, Trash2, UserRound } from 'lucide-react';
import Card from '../components/ui/Card';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import PageIcon from '../components/ui/PageIcon';
import { useAuth } from '../context/AuthContext';
import { getPersonalProfile, savePersonalProfile, uploadProfilePhoto, removeProfilePhoto, profilePhotoUrl, type PersonalProfile } from '../services/profileService';
import './ProfileSettings.css';

export default function ProfileSettings() {
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<PersonalProfile | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getPersonalProfile().then((data) => {
      if (!live) return;
      setProfile(data); setName(data.name); setPhone(data.phone); setError('');
    }).catch((err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : 'Could not load your profile.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [retry]);

  const update = async (action: () => Promise<PersonalProfile>, message: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await action();
      setProfile(data); setNotice(message); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update your profile.'); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void update(() => savePersonalProfile(name, phone), 'Profile saved.');
  };

  if (loading) return <Loader message="Loading your profile…" skeleton="page" />;
  if (!profile) return <ErrorState message={error || 'Could not load your profile.'} onRetry={() => { setLoading(true); setRetry((value) => value + 1); }} />;

  return (
    <div className="profile-settings">
      <div className="ch-page-head"><PageIcon /><div>
        <h1 className="ch-page-title">My profile</h1>
        <p className="ch-page-sub">Update your photo and personal details.</p>
      </div></div>
      {error && <div className="ch-alert ch-alert-error" role="alert">{error}</div>}
      {notice && <div className="ch-alert ch-alert-success" role="status">{notice}</div>}
      <Card title="Profile photo" subtitle="Your photo appears in the sidebar account menu.">
        <div className="profile-photo-row">
          <div className="profile-photo-preview">
            {profile.avatar_version ? <img src={profilePhotoUrl(profile.avatar_version)} alt="Your profile" /> : <UserRound size={38} aria-hidden="true" />}
          </div>
          <div>
            <div className="profile-photo-actions">
              <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" disabled={busy} onClick={() => input.current?.click()}><Camera size={15} /> Upload photo</button>
              {profile.avatar_version && <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" disabled={busy} onClick={() => { void update(removeProfilePhoto, 'Photo removed.'); }}><Trash2 size={15} /> Remove</button>}
            </div>
            <p className="ch-hint">PNG, JPEG, or WebP. Maximum 2 MB.</p>
            <input ref={input} className="profile-photo-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a profile photo" disabled={busy} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void update(() => uploadProfilePhoto(file), 'Photo updated.');
            }} />
          </div>
        </div>
      </Card>
      <Card title="Personal details">
        <form onSubmit={save}>
          <fieldset disabled={busy} className="profile-details-fields">
            <label className="profile-field"><span className="ch-label">Display name</span><input className="ch-input" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
            <label className="profile-field"><span className="ch-label">Phone number</span><input className="ch-input" type="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></label>
            <label className="profile-field"><span className="ch-label">Email</span><input className="ch-input" value={profile.email} readOnly /></label>
            <label className="profile-field"><span className="ch-label">Role</span><input className="ch-input" value={profile.role} readOnly /></label>
          </fieldset>
          <p className="ch-hint">Your administrator manages your email and role.</p>
          <button type="submit" className="ch-btn ch-btn-primary" disabled={busy}><Save size={15} /> {busy ? 'Working…' : 'Save changes'}</button>
        </form>
      </Card>
    </div>
  );
}
