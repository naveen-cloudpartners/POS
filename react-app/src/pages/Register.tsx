import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Store,
  Hash,
  ReceiptText,
  Factory,
  User,
  Mail,
  Phone,
  MapPin,
  Building,
  Map,
  Globe,
  Cloud,
  ShieldCheck,
  Boxes,
  Users,
  ShoppingCart,
  Clock3,
  BarChart3,
  Check,
  X,
  Loader2,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import '../styles/register.css';
import API_BASE from '../services/api';

/* ==========================================================================
   Muster POS — Organization Registration (no passwords here).
   Collects org + owner + address only.
   POST /api/organizations/register -> Organizations row (status "pending")
   + admin approval email. On approval a Catalyst Authentication user is
   created and the owner sets their password via Catalyst's activation
   email. Catalyst is the only credential store.
   ========================================================================== */

/** Editable fields of the Organizations table (frontend subset). */
export interface OrganizationRegistrationForm {
  organization_name: string;
  business_reg_no: string;
  tin_number: string;
  industry: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  address: string;
  city: string;
  province: string;
  country: string;
}

type FieldErrors = Partial<Record<keyof OrganizationRegistrationForm, string>>;

const INDUSTRIES: string[] = [
  'Restaurant',
  'Retail Shop',
  'Supermarket',
  'Pharmacy',
  'Hotel',
  'Bakery',
  'Electronics',
  'Hardware',
  'Other',
];

const PROVINCES: string[] = [
  'Western',
  'Central',
  'Southern',
  'Northern',
  'Eastern',
  'North Western',
  'North Central',
  'Uva',
  'Sabaragamuwa',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INITIAL_FORM: OrganizationRegistrationForm = {
  organization_name: '',
  business_reg_no: '',
  tin_number: '',
  industry: '',
  owner_name: '',
  owner_email: '',
  owner_phone: '',
  address: '',
  city: '',
  province: '',
  country: 'Sri Lanka',
};

const TRUST_BADGES: string[] = [
  'Sri Lanka Ready',
  'Secure Cloud Platform',
  'Multi-User Access',
  'Business Analytics',
];

const BENEFITS: Array<{ icon: React.ElementType; title: string; desc: string }> = [
  { icon: Boxes, title: 'Inventory Management', desc: 'Real-time stock across every outlet and warehouse.' },
  { icon: Users, title: 'Customer Management', desc: 'Profiles, loyalty and purchase history in one place.' },
  { icon: ShoppingCart, title: 'Sales Tracking', desc: 'Every bill, refund and tender type captured live.' },
  { icon: Clock3, title: 'Shift Management', desc: 'Cashier shifts, floats and closings reconciled daily.' },
  { icon: BarChart3, title: 'Business Reports', desc: 'Margins, best-sellers and outlet performance.' },
];

/* ---------- Reusable field components ---------- */

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ id, label, required, error, icon: Icon, children }) => (
  <div className="org-field">
    <label className="org-label" htmlFor={id}>
      {label}
      {required === true && <span className="org-req" aria-hidden="true"> *</span>}
    </label>
    <div className={`org-input-wrap${error !== undefined && error !== '' ? ' has-error' : ''}`}>
      <Icon className="org-input-icon" aria-hidden="true" />
      {children}
    </div>
    {error !== undefined && error !== '' && (
      <p className="org-error" role="alert">{error}</p>
    )}
  </div>
);

interface TextFieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  icon: React.ElementType;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  disabled?: boolean;
  helper?: string;
}

const TextField: React.FC<TextFieldProps> = (props) => (
  <Field id={props.id} label={props.label} required={props.required} error={props.error} icon={props.icon}>
    <input
      id={props.id}
      className="org-input"
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
      disabled={props.disabled}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
      aria-invalid={props.error !== undefined && props.error !== ''}
    />
    {props.helper !== undefined && props.helper !== '' && (
      <span className="org-helper">{props.helper}</span>
    )}
  </Field>
);

interface SelectFieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  icon: React.ElementType;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  helper?: string;
}

const SelectField: React.FC<SelectFieldProps> = (props) => (
  <Field id={props.id} label={props.label} required={props.required} error={props.error} icon={props.icon}>
    <select
      id={props.id}
      className="org-input org-select"
      value={props.value}
      disabled={props.disabled}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => props.onChange(e.target.value)}
      aria-invalid={props.error !== undefined && props.error !== ''}
    >
      <option value="">{props.placeholder}</option>
      {props.options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
    {props.helper !== undefined && props.helper !== '' && (
      <span className="org-helper">{props.helper}</span>
    )}
  </Field>
);

/* ---------- Validation (per step) ---------- */

const STEP_FIELDS: Array<Array<keyof OrganizationRegistrationForm>> = [
  ['organization_name', 'business_reg_no', 'industry'],
  ['owner_name', 'owner_email', 'owner_phone'],
  ['address', 'city', 'province', 'country'],
];

const STEP_TITLES: string[] = [
  'Organization Information',
  'Owner Information',
  'Address Information',
];

function validateField(
  key: keyof OrganizationRegistrationForm,
  f: OrganizationRegistrationForm,
): string | undefined {
  switch (key) {
    case 'organization_name':
      return f.organization_name.trim() === '' ? 'Business name is required.' : undefined;
    case 'business_reg_no':
      return f.business_reg_no.trim() === '' ? 'Business registration number is required.' : undefined;
    case 'industry':
      return f.industry === '' ? 'Please select an industry.' : undefined;
    case 'owner_name':
      return f.owner_name.trim() === '' ? 'Owner name is required.' : undefined;
    case 'owner_email':
      return !EMAIL_RE.test(f.owner_email.trim()) ? 'Enter a valid email address.' : undefined;
    case 'owner_phone':
      return f.owner_phone.trim() === '' ? 'Owner mobile number is required.' : undefined;
    case 'address':
      return f.address.trim() === '' ? 'Address is required.' : undefined;
    case 'city':
      return f.city.trim() === '' ? 'City is required.' : undefined;
    case 'province':
      return f.province === '' ? 'Please select a province.' : undefined;
    default:
      return undefined;
  }
}

/** Validate only the fields of one step (0, 1, 2). */
function validateStep(f: OrganizationRegistrationForm, step: number): FieldErrors {
  const er: FieldErrors = {};
  for (const key of STEP_FIELDS[step]) {
    const msg = validateField(key, f);
    if (msg !== undefined) er[key] = msg;
  }
  return er;
}

/* ---------- Page ---------- */

const Register: React.FC = () => {
  const [form, setForm] = useState<OrganizationRegistrationForm>(INITIAL_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [step, setStep] = useState<number>(0);
  const [touchedSteps, setTouchedSteps] = useState<boolean[]>([false, false, false]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState<boolean>(false);

  const set = (key: keyof OrganizationRegistrationForm) => (value: string) => {
    const next: OrganizationRegistrationForm = { ...form, [key]: value };
    setForm(next);
    // Live re-validate the edited field once its step has been attempted.
    setErrors((prev) => {
      const merged: FieldErrors = { ...prev };
      const msg = validateField(key, next);
      if (touchedSteps[step] === true || prev[key] !== undefined) {
        if (msg !== undefined) merged[key] = msg;
        else delete merged[key];
      }
      return merged;
    });
  };

  const markStepTouched = (s: number) => {
    setTouchedSteps((t) => t.map((v, i) => (i === s ? true : v)));
  };


  const goNext = () => {
    const er = validateStep(form, step);
    markStepTouched(step);
    if (Object.keys(er).length > 0) {
      setErrors((prev) => ({ ...prev, ...er }));
      return;
    }
    setErrors((prev) => {
      const merged: FieldErrors = { ...prev };
      for (const k of STEP_FIELDS[step]) delete merged[k];
      return merged;
    });
    setStep((s) => Math.min(s + 1, 2));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er = validateStep(form, 2);
    markStepTouched(2);
    setErrors((prev) => ({ ...prev, ...er }));
    if (Object.keys(er).length > 0) {
      const firstError = document.querySelector('.org-input-wrap.has-error');
      if (firstError !== null) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitError('');
    setSubmitting(true);
    try {
      const payload: Record<string, string> = {
        organization_name: form.organization_name.trim(),
        business_reg_no: form.business_reg_no.trim(),
        tin_number: form.tin_number.trim(),
        industry: form.industry,
        owner_name: form.owner_name.trim(),
        owner_email: form.owner_email.trim(),
        owner_phone: form.owner_phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        province: form.province,
        country: form.country,
      };
      const resp = await fetch(`${API_BASE}/organizations/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: { success?: boolean; message?: string } = await resp.json().catch(() => ({}));
      if (resp.status === 409) {
        setSubmitError('This organization is already registered.');
        return;
      }
      if (!resp.ok || data.success !== true) {
        setSubmitError(
          typeof data.message === 'string' && data.message !== ''
            ? data.message
            : 'Registration failed. Please try again.',
        );
        return;
      }
      setShowSuccess(true);
    } catch {
      setSubmitError('Unable to connect. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeModal = () => setShowSuccess(false);

  return (
    <div className="org-page">
      {/* ---------- Hero ---------- */}
      <header className="org-hero">
        <Link to="/" className="org-logo" aria-label="Muster POS home">
          <span className="org-logo-mark" aria-hidden="true"><Cloud /></span>
          <span className="org-logo-text">Muster POS</span>
        </Link>
        <h1 className="org-hero-title">Register Your Organization</h1>
        <p className="org-hero-sub">
          Create your organization account and start managing sales,
          inventory, customers and reporting with Muster POS.
        </p>
        <ul className="org-badges" aria-label="Platform highlights">
          {TRUST_BADGES.map((b) => (
            <li key={b} className="org-badge">
              <Check aria-hidden="true" />
              {b}
            </li>
          ))}
        </ul>
      </header>

      {/* ---------- Main two-column ---------- */}
      <div className="org-layout">
        {/* Left: benefits illustration panel */}
        <aside className="org-side" aria-label="Why Muster POS">
          <div className="org-side-card">
            <div className="org-graphic" aria-hidden="true">
              <div className="org-graphic-orb orb-a" />
              <div className="org-graphic-orb orb-b" />
              <div className="org-graphic-orb orb-c" />
              <div className="org-kpi kpi-a">
                <BarChart3 aria-hidden="true" />
                <span><strong>+24.8%</strong><em>Sales this month</em></span>
              </div>
              <div className="org-kpi kpi-b">
                <Boxes aria-hidden="true" />
                <span><strong>12,480</strong><em>Products in stock</em></span>
              </div>
              <div className="org-kpi kpi-c">
                <ShieldCheck aria-hidden="true" />
                <span><strong>99.99%</strong><em>Cloud uptime</em></span>
              </div>
            </div>
            <h2 className="org-side-title">Everything your business needs to sell smarter</h2>
            <p className="org-side-sub">
              One organization account gives every outlet, cashier and manager
              the same live view of the business.
            </p>
            <ul className="org-benefits" role="list">
              {BENEFITS.map((b) => (
                <li key={b.title} className="org-benefit">
                  <span className="org-benefit-icon" aria-hidden="true"><b.icon /></span>
                  <span className="org-benefit-text">
                    <strong>{b.title}</strong>
                    <span>{b.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Right: registration form card */}
        <main className="org-main">
          <form className="org-card" onSubmit={handleSubmit} noValidate>
            {/* Step indicator + progress */}
            <div className="org-steps" aria-label="Registration progress">
              <ol className="org-steps-list">
                {STEP_TITLES.map((label, i) => (
                  <li
                    key={label}
                    className={`org-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
                    aria-current={i === step ? 'step' : undefined}
                  >
                    <span className="org-step-dot" aria-hidden="true">
                      {i < step ? <Check /> : i + 1}
                    </span>
                    <span className="org-step-label">{label}</span>
                  </li>
                ))}
              </ol>
              <p className="org-step-count" aria-live="polite">Step {step + 1} of 3</p>
              <div
                className="org-progress"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={3}
                aria-valuenow={step + 1}
                aria-label={`Step ${step + 1} of 3`}
              >
                <div
                  className="org-progress-fill"
                  style={{ width: `${((step + 1) / 3) * 100}%` }}
                />
              </div>
            </div>

            {step === 0 && (
            <section className="org-section" aria-labelledby="org-s1" key="step-0">
              <h2 id="org-s1" className="org-section-title">
                <Building2 aria-hidden="true" />
                Organization Information
              </h2>
              <div className="org-grid">
                <TextField id="org-name" label="Business Name" required icon={Store}
                  value={form.organization_name} onChange={set('organization_name')}
                  placeholder="e.g. Ceylon Food House" autoComplete="organization"
                  error={errors.organization_name} />
                <TextField id="org-brn" label="Business Registration Number" required icon={Hash}
                  value={form.business_reg_no} onChange={set('business_reg_no')}
                  placeholder="e.g. PV-00345678" error={errors.business_reg_no} />
                <TextField id="org-tin" label="TIN Number" icon={ReceiptText}
                  value={form.tin_number} onChange={set('tin_number')}
                  placeholder="e.g. 123456789-V (optional)" />
                <SelectField id="org-industry" label="Industry" required icon={Factory}
                  value={form.industry} onChange={set('industry')}
                  options={INDUSTRIES} placeholder="Select industry…"
                  error={errors.industry} />
              </div>
            </section>
            )}

            {step === 1 && (
            <section className="org-section" aria-labelledby="org-s2" key="step-1">
              <h2 id="org-s2" className="org-section-title">
                <User aria-hidden="true" />
                Owner Information
              </h2>
              <div className="org-grid">
                <TextField id="org-owner" label="Owner Name" required icon={User}
                  value={form.owner_name} onChange={set('owner_name')}
                  placeholder="e.g. Amara Perera" autoComplete="name"
                  error={errors.owner_name} />
                <TextField id="org-email" label="Owner Email" required icon={Mail}
                  type="email" value={form.owner_email} onChange={set('owner_email')}
                  placeholder="owner@company.lk" autoComplete="email"
                  error={errors.owner_email} />
                <TextField id="org-phone" label="Owner Mobile Number" required icon={Phone}
                  type="tel" value={form.owner_phone} onChange={set('owner_phone')}
                  placeholder="+94 77 123 4567" autoComplete="tel"
                  error={errors.owner_phone} />
              </div>
            </section>
            )}

            {step === 2 && (
            <>
            <section className="org-section" aria-labelledby="org-s3" key="step-2a">
              <h2 id="org-s3" className="org-section-title">
                <MapPin aria-hidden="true" />
                Address Information
              </h2>
              <div className="org-grid">
                <TextField id="org-address" label="Address" required icon={MapPin}
                  value={form.address} onChange={set('address')}
                  placeholder="Street address" autoComplete="street-address"
                  error={errors.address} />
                <div className="org-grid-2">
                  <TextField id="org-city" label="City" required icon={Building}
                    value={form.city} onChange={set('city')}
                    placeholder="e.g. Colombo" autoComplete="address-level2"
                    error={errors.city} />
                  <SelectField id="org-province" label="Province" required icon={Map}
                    value={form.province} onChange={set('province')}
                    options={PROVINCES} placeholder="Select province…"
                    error={errors.province} />
                </div>
              </div>
            </section>

            <section className="org-section" aria-labelledby="org-s4">
              <h2 id="org-s4" className="org-section-title">
                <Globe aria-hidden="true" />
                Country
              </h2>
              <SelectField id="org-country" label="Country" icon={Globe}
                value={form.country} onChange={set('country')}
                options={['Sri Lanka']} placeholder="Sri Lanka"
                disabled helper="Version 1 currently supports Sri Lankan businesses only." />
            </section>

            
            </>
            )}

            {submitError !== '' && (
              <p className="org-form-error" role="alert">{submitError}</p>
            )}
            <div className="org-nav">
              {step > 0 && (
                <button type="button" className="org-back" onClick={goBack}>
                  <ArrowLeft aria-hidden="true" />
                  Back
                </button>
              )}
              {step < 2 ? (
                <button type="button" className="org-submit org-grow" onClick={goNext}>
                  Continue
                  <ArrowRight aria-hidden="true" />
                </button>
              ) : (
                <button type="submit" className="org-submit org-grow" disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="spin" aria-hidden="true" /> Submitting…</>
                  ) : (
                    'Submit Registration Request'
                  )}
                </button>
              )}
            </div>

            <p className="org-login">
              Already have an account? <Link to="/login">Login</Link>
            </p>
          </form>
        </main>
      </div>

      {/* ---------- Success modal ---------- */}
      {showSuccess && (
        <div className="org-modal-backdrop" onClick={closeModal}>
          <div
            className="org-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="org-modal-title"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <button type="button" className="org-modal-close" onClick={closeModal} aria-label="Close dialog">
              <X aria-hidden="true" />
            </button>
            <span className="org-modal-icon" aria-hidden="true"><Check /></span>
            <h2 id="org-modal-title" className="org-modal-title">Registration Submitted</h2>
            <p className="org-modal-body">
              Thank you for choosing Muster POS.<br />
              Your registration request has been prepared successfully.
            </p>
            <p className="org-modal-body muted">
              In the next implementation phase this request will be submitted
              for administrative approval.
            </p>
            <p className="org-status">
              Status: <span className="org-status-pill">Pending Approval</span>
            </p>
            <p className="org-modal-support">Muster POS Support</p>
            <button type="button" className="org-submit org-modal-btn" onClick={closeModal}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Register;
