
import Image from "next/image";
import { X } from "lucide-react";
import React from "react";
import { useMaximizeImageStore } from "@/store/maximize-image-store";

const MaximizedImage = () => {
  const { isOpen, setIsOpen, imageUrl } = useMaximizeImageStore();

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false);
    }
  };

  

  return isOpen ? (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center mx-auto"
      onClick={handleBackdropClick}
    >
      <button
        className="absolute top-5 right-5 z-60"
        onClick={() => setIsOpen(false)}
      >
        <X className="w-7 h-7 text-white" />
      </button>
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <Image
          src={imageUrl || ""}
          alt="maximized image"
          width={1200}
          height={800}
          className="object-contain"
          unoptimized
          priority
          sizes="(max-width: 1200px) 90vw, 1200px"
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            width: 'auto',
            height: 'auto'
          }}
        />
      </div>
    </div>
  ) : null;
};

export default MaximizedImage;