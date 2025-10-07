"use client";

import Link from "next/link";

export default function Header() {
  return (
    <header className="fixed top-0 w-full z-50 glass-card border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <span className="text-xl font-bold gradient-text">Web Capture</span>
        </Link>

        <nav className="hidden md:flex items-center space-x-8">
          <a
            href="#features"
            className="text-gray-300 hover:text-cyan-400 transition-colors cursor-pointer"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-gray-300 hover:text-cyan-400 transition-colors cursor-pointer"
          >
            How It Works
          </a>
          <a
            href="#use-cases"
            className="text-gray-300 hover:text-cyan-400 transition-colors cursor-pointer"
          >
            Use Cases
          </a>
          <a
            href="#stats"
            className="text-gray-300 hover:text-cyan-400 transition-colors cursor-pointer"
          >
            Stats
          </a>
        </nav>

        <button className="bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-2 rounded-lg font-semibold hover:shadow-lg neon-glow transition-all duration-300">
          Add to Chrome
        </button>
      </div>
    </header>
  );
}

