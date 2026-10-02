import React from 'react';
import Navbar from '../components/Navbar';
import HeroSection from '../components/HeroSection';
import DashboardPreview from '../components/DashboardPreview';
import StatisticsSection from '../components/StatisticsSection';
import DemoSection from '../components/DemoSection';
import FeaturesSection from '../components/FeaturesSection';
import IntegrationSection from '../components/IntegrationSection';
import SecuritySection from '../components/SecuritySection';
import PricingSection from '../components/PricingSection';
import Footer from '../components/Footer';

import '../styles/design-system.css';
import '../styles/landing.css';
import '../styles/public-custom.css';

/**
 * Muster POS — Landing (pure marketing page).
 * No session checking, no redirects, no auth logic.
 * RootEntry handles all authenticated routing at /app/
 */
const Landing: React.FC = () => {
  return (
    <div className="landing-page muster-landing-page">
      <Navbar />
      <main>
        <HeroSection />
        <StatisticsSection />
        <DashboardPreview />
        <DemoSection />
        <FeaturesSection />
        <IntegrationSection />
        <SecuritySection />
        <PricingSection />
      </main>
      <Footer />
    </div>
  );
};

export default Landing;
