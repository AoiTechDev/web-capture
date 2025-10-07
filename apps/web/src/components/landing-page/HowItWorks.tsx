"use client";

export default function HowItWorks() {
  const steps = [
    {
      number: "1",
      gradient: "from-cyan-400 to-blue-600",
      title: "Browse & Spot",
      description:
        "Navigate any website and find content worth saving. Could be inspiration, research, or just something cool.",
    },
    {
      number: "2",
      gradient: "from-purple-500 to-pink-600",
      title: (
        <>
          Capture <span className="font-mono text-cyan-400">(Ctrl+Shift+S)</span>
        </>
      ),
      description:
        "Hit the magic shortcut. Select what you want or capture the whole page. It's saved instantly with context.",
    },
    {
      number: "3",
      gradient: "from-green-400 to-emerald-600",
      title: "Organize & Share",
      description:
        "Everything appears in your beautiful dashboard. Tag, categorize, search, and share collections with your team.",
    },
  ];

  return (
    <section id="how-it-works" className="py-20 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-black mb-4">
            How It <span className="gradient-text">Works</span>
          </h2>
          <p className="text-base sm:text-xl text-gray-300">
            Three simple steps to organize your internet
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-12">
          {steps.map((step, index) => (
            <div key={index} className="text-center">
              <div className="relative mb-8">
                <div
                  className={`w-20 h-20 bg-gradient-to-br ${step.gradient} rounded-2xl flex items-center justify-center mx-auto brutalist-shadow neon-glow`}
                >
                  <span className="text-3xl font-black text-white">
                    {step.number}
                  </span>
                </div>
              </div>
              <h3 className="text-2xl font-bold mb-4 text-white">
                {step.title}
              </h3>
              <p className="text-gray-300 leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

