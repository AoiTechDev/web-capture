"use client";

export default function Stats() {
  const stats = [
    {
      value: "2.5M+",
      label: "Captures Saved",
      color: "text-cyan-400",
    },
    {
      value: "50K+",
      label: "Active Users",
      color: "text-purple-400",
    },
    {
      value: "15min",
      label: "Saved Daily",
      color: "text-green-400",
    },
    {
      value: "4.9★",
      label: "Chrome Store Rating",
      color: "text-pink-400",
    },
  ];

  return (
    <section id="stats" className="py-20 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-8 text-center">
          {stats.map((stat, index) => (
            <div key={index}>
              <div className={`text-5xl font-black ${stat.color} mb-2`}>
                {stat.value}
              </div>
              <div className="text-gray-300">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

