# Contents Architecture

This directory contains all the content scripts and UI components for the Chrome extension.

## 📁 Folder Structure

```
contents/
├── capture.ts                    # Main entry point - keyboard shortcuts & message handling
├── styles/
│   └── index.css                # Global styles for overlays and notifications
├── features/                    # Feature-based modules
│   ├── auth/
│   │   ├── check-auth.ts       # Authentication checking
│   │   └── auth-notification.ts # Authentication notification UI
│   ├── search/
│   │   ├── search-overlay.ts   # Search overlay management
│   │   └── search-results.ts   # Search results rendering
│   ├── capture/
│   │   ├── index.ts            # Main capture module exports
│   │   ├── element-capture.ts  # Element selection & capture mode
│   │   ├── screenshot-capture.ts # Screenshot mode & region selection
│   │   ├── capture-element.ts  # Element data extraction
│   │   ├── detect-element-type.ts # Smart element type detection
│   │   └── crop-and-upload.ts  # Image cropping & upload
│   └── category/
│       ├── category-overlay.ts  # Category selection overlay UI
│       └── category-storage.ts  # Category & tags storage management
├── components/                  # Reusable UI components
│   ├── highlight-overlay.ts    # Element highlighting overlay
│   └── overlay-styles.ts       # Shared overlay styling functions
└── utils/                       # Utility functions
    └── image-utils.ts          # Image processing utilities
```

## 🎯 Architecture Principles

### Feature-Based Organization
- **`features/`** - Organized by feature domain (auth, search, capture, category)
- Each feature folder contains related logic and is self-contained
- Easy to locate and modify feature-specific code

### Component Reusability
- **`components/`** - Shared UI components used across features
- Pure components without business logic dependencies
- Consistent styling through `overlay-styles.ts`

### Clear Separation of Concerns
- **Entry Point** (`capture.ts`) - Keyboard shortcuts and message routing only
- **Features** - Business logic and feature-specific behavior
- **Components** - Reusable UI elements
- **Utils** - Pure utility functions

## 🔄 Data Flow

```
User Action (Keyboard/Click)
    ↓
capture.ts (Main Entry)
    ↓
Auth Check (features/auth/)
    ↓
Feature Module (features/capture|search|category/)
    ↓
UI Components (components/)
    ↓
Background Script (via chrome.runtime.sendMessage)
```

## 📦 Key Features

### Authentication (`features/auth/`)
- Checks if user is authenticated before allowing captures
- Shows notification when auth is required

### Search (`features/search/`)
- Overlay UI for searching captures
- Results rendering with thumbnails
- Semantic and metadata search support

### Capture (`features/capture/`)
- **Element Capture**: Select and capture specific elements
- **Screenshot**: Region-based screenshot capture
- **Smart Detection**: Automatically detects images, links, code, text
- **Category Support**: Optional categorization of captures

### Category Management (`features/category/`)
- Category selection overlay
- Tag management
- Recent categories/tags tracking

## 🛠️ Usage Examples

### Import capture features:
```typescript
import { 
  toggleSelectionMode, 
  startScreenshotMode, 
  exitAllModes 
} from "~contents/features/capture"
```

### Import auth utilities:
```typescript
import { checkAuth } from "~contents/features/auth/check-auth"
import { showAuthNotification } from "~contents/features/auth/auth-notification"
```

### Import search:
```typescript
import { 
  toggleSearchOverlay, 
  closeSearchOverlay 
} from "~contents/features/search/search-overlay"
```

## 🎨 Styling

All styles are centralized in `styles/index.css` using CSS classes:
- `.auth-notification` - Authentication notification
- `.search-overlay` - Search overlay container
- `.search-result-item` - Individual search results
- And more...

## 🔧 Extending the Code

### Adding a new feature:
1. Create a new folder in `features/`
2. Add feature logic files
3. Export main functions from an `index.ts`
4. Import and use in `capture.ts`

### Adding a new component:
1. Create file in `components/`
2. Keep it pure and reusable
3. Use `overlay-styles.ts` for consistent styling

### Adding a utility:
1. Create file in `utils/`
2. Keep functions pure (no side effects)
3. Export individual functions

