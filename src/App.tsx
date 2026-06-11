import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Hero } from "@/sections/Hero";
import { Shift } from "@/sections/Shift";
import { System } from "@/sections/System";
import { Evolve } from "@/sections/Evolve";
import { Everywhere } from "@/sections/Everywhere";
import { CTA } from "@/sections/CTA";
import { useSnapAssist } from "@/lib/useSnapAssist";

export default function App() {
  useSnapAssist();
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex-1">
        <Hero />
        <Shift />
        <System />
        <Evolve />
        <Everywhere />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
