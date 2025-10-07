import Header from "@/components/landing-page/Header";
import Hero from "@/components/landing-page/Hero";
import Features from "@/components/landing-page/Features";
import HowItWorks from "@/components/landing-page/HowItWorks";
import UseCases from "@/components/landing-page/UseCases";
import Stats from "@/components/landing-page/Stats";
import CTA from "@/components/landing-page/CTA";
import Footer from "@/components/landing-page/Footer";

export default function Home() {
  return (
    <div className="gradient-bg text-white overflow-x-hidden">
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <UseCases />
        {/* <Stats /> */}
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
