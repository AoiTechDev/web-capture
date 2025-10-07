"use client";

export default function UseCases() {
  const useCases = [
    {
      icon: (
        <svg
          className="w-6 h-6 text-white"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M8 3a1 1 0 011-1h2a1 1 0 011 1v.5h2V3a1 1 0 011-1h2a1 1 0 011 1v.5a1 1 0 001 1V6a1 1 0 01-1 1v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a1 1 0 01-1-1V4.5a1 1 0 001-1V3z" />
        </svg>
      ),
      gradient: "from-cyan-400 to-blue-600",
      title: "Developers",
      description:
        "Save code snippets, documentation, and Stack Overflow solutions. Build a searchable knowledge base of solutions.",
      codeExample: "const capture = await webCapture.save(selection);",
    },
    {
      icon: (
        <svg
          className="w-6 h-6 text-white"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49L17.5 6.5 9.99 9.99 6.5 17.5zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z" />
        </svg>
      ),
      gradient: "from-purple-500 to-pink-600",
      title: "Designers",
      description:
        "Collect design inspiration, UI patterns, and color schemes. Create mood boards that actually make sense.",
      colors: [
        "from-cyan-400 to-blue-600",
        "from-purple-500 to-pink-600",
        "from-green-400 to-emerald-600",
      ],
    },
  ];

  return (
    <section id="use-cases" className="py-20 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-black mb-4">
            Built for <span className="gradient-text">Power Users</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          {useCases.map((useCase, index) => (
            <div
              key={index}
              className="glass-card p-8 rounded-2xl brutalist-shadow"
            >
              <div className="flex items-center mb-6">
                <div
                  className={`w-12 h-12 bg-gradient-to-br ${useCase.gradient} rounded-xl flex items-center justify-center mr-4`}
                >
                  {useCase.icon}
                </div>
                <h3 className="text-2xl font-bold text-white">
                  {useCase.title}
                </h3>
              </div>
              <p className="text-gray-300 mb-4">{useCase.description}</p>
              {useCase.codeExample && (
                <div className="font-mono text-sm text-cyan-400 bg-gray-900 p-3 rounded-lg">
                  {useCase.codeExample}
                </div>
              )}
              {useCase.colors && (
                <div className="flex space-x-2">
                  {useCase.colors.map((color, colorIndex) => (
                    <div
                      key={colorIndex}
                      className={`w-8 h-8 bg-gradient-to-br ${color} rounded`}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

