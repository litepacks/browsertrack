---
title: Visual Notes & Annotations
description: Visual annotations, element hover notes, drag-and-drop region notes, and persistent on-screen pins
order: 3
---

# Visual Notes & Screen Annotations 📝

BrowserTrack enables developers and designers to leave visual feedback directly on DOM elements, custom screen regions, or full pages without leaving the browser.

---

## 🎯 Annotation Modes

### 1. Element Notes (Alt + Click)
- **How to use**: Hold <kbd>Alt</kbd> and hover over any element on the page. The element will highlight with its semantic CSS selector and dimensions. Click to open the note editor.
- Alternatively, click the **🎯 Element** button in the floating toolbar.
- **Context captured**:
  - Semantic CSS selector (e.g. `[data-testid="stats-banner"]` or `#user-card`)
  - Element dimensions and bounding rectangle (`x`, `y`, `width`, `height`)
  - Sanitized outerHTML and DOM hierarchy
  - Viewport dimensions and scroll offsets
  - Element screenshot snapshot

### 2. Region / Area Notes (Drag & Drop)
- **How to use**: Click the **📐 Region** button in the floating toolbar.
- Drag a bounding rectangle over any area on the screen.
- A top banner will appear with a **✕ Cancel (Esc)** button.
- Releasing the mouse opens the note modal with the cropped region screenshot and coordinates.

### 3. Full-Page Notes
- **How to use**: Click the **📄 Page** button in the toolbar.
- Captures the entire page viewport state, URL route, and document context.

---

## 📌 Persistent On-Screen Markers

When your application loads or syncs with the daemon:
- BrowserTrack automatically fetches all open notes for the project.
- **Element Pins (`📝 #1`)**: Placed at the top-left of each annotated element. Hovering highlights the element.
- **Region Outlines (`📐 #2`)**: Renders a clean dashed boundary box around the selected area.
- **Page Notes (`📄`)**: Pinned at the top right of the viewport.
- **Responsive Tracking**: Markers dynamically stay anchored to elements as the page scrolls or resizes.

---

## 🔍 Interactive Popover Details Card

Clicking on any note marker opens the Note Details Card:

- **Full Message**: Displays the complete text/instruction.
- **Target Metadata**: Viewport dimensions, target selector, and creation timestamp.
- **Action Buttons**:
  - **`✅ Resolve Note`**: Marks the note as `RESOLVED` in real time.
  - **`🗑️ Delete Note`**: Removes the note permanently from the database.
  - **`✕ Close`**: Closes the popover.

---

## 🛠️ Toolbar Controls

The bottom-right floating toolbar gives quick access:
- **`🎯 Element`**: Toggle element inspection mode.
- **`📐 Region`**: Activate rectangle drag mode.
- **`📄 Page`**: Open full-page note modal.
- **`📌 Notes (N)`**: Toggle visibility of all note markers on screen.
