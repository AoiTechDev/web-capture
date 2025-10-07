"use client";

import Image from "next/image";

export default function Hero() {
  return (
    <section className="pt-24 min-h-[800px] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 py-12 sm:py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl lg:text-7xl font-black leading-tight">
                Your Internet
                <span className="gradient-text block">Memory,</span>
                <span className="text-white">Instantly </span>
                <span className="gradient-text">Organized</span>
              </h1>
              <p className="text-base sm:text-xl text-gray-300 max-w-lg">
                Capture anything from the web with a single keyboard shortcut.
                Screenshots, text, images, links - all beautifully organized in
                your personal visual database.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button className="bg-gradient-to-r from-cyan-500 to-purple-600 px-8 py-4 rounded-xl font-bold text-lg neon-glow hover-scale">
                <svg
                  className="inline-block w-5 h-5 mr-2"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.84 4.67h1.68v8.36h-1.68V4.67zM12 18.155c-.635 0-1.155-.519-1.155-1.155 0-.635.52-1.155 1.155-1.155.636 0 1.155.52 1.155 1.155 0 .636-.519 1.155-1.155 1.155z" />
                </svg>
                Add to Chrome - Free
              </button>
              <button className="glass-card px-8 py-4 rounded-xl font-semibold text-lg hover-scale border-2 border-cyan-400">
                <svg
                  className="inline-block w-5 h-5 mr-2"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                Watch Demo
              </button>
            </div>

            <div className="flex items-center space-x-4 font-mono text-sm">
              <div className="capture-animation bg-gray-800 px-3 py-2 rounded-lg border border-cyan-400">
                <span className="text-cyan-400">Ctrl</span> +{" "}
                <span className="text-purple-400">Shift</span> +{" "}
                <span className="text-green-400">S</span>
              </div>
              <span className="text-gray-400">Instant capture shortcut</span>
            </div>
          </div>

          <div className="relative">
            <div className="relative w-full h-96">
              <div className="floating-animation absolute top-0 right-0 w-32 h-24 glass-card rounded-lg brutalist-shadow p-4">
                <Image
                  className="w-full h-full object-cover rounded"
                  src="https://storage.googleapis.com/uxpilot-auth.appspot.com/9176793c80-11a62e41f9c0271ec748.png"
                  alt="modern website screenshot"
                  width={128}
                  height={96}
                />
              </div>
              <div className="floating-animation absolute top-20 left-0 w-40 h-28 glass-card rounded-lg brutalist-shadow p-4">
                <Image
                  className="w-full h-full object-cover rounded"
                  src="https://storage.googleapis.com/uxpilot-auth.appspot.com/54dfc0376c-d09beaebf1779c440f6a.png"
                  alt="code snippet"
                  width={160}
                  height={112}
                />
              </div>
              <div className="floating-animation absolute bottom-0 right-12 w-36 h-32 glass-card rounded-lg brutalist-shadow p-4">
                <Image
                  className="w-full h-full object-cover rounded"
                  src="https://storage.googleapis.com/uxpilot-auth.appspot.com/783ee56b32-529071cbdc73a268b54f.png"
                  alt="design inspiration"
                  width={144}
                  height={128}
                />
              </div>
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-gradient-to-br from-cyan-400 to-purple-600 rounded-full flex items-center justify-center neon-glow">
                <svg
                  className="w-8 h-8 text-white"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M7 2v11h3v9l7-12h-4l4-8z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

