/**
 * OpenCV.js-based land segmentation engine.
 * Uses GrabCut + Canny edge detection + contour extraction.
 * Replaces the circular buffer approach entirely.
 */

declare const cv: any;

export interface PixelPoint {
  x: number;
  y: number;
}

export interface SegmentationResult {
  contourLatLngs: [number, number][][]; // array of rings, each ring is [lat, lng][]
  confidence: number;
}

/** Wait for OpenCV.js to be loaded */
export function waitForOpenCV(timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof cv !== 'undefined' && cv.Mat) {
      resolve();
      return;
    }
    const start = Date.now();
    const check = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(check);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(check);
        reject(new Error('OpenCV.js failed to load'));
      }
    }, 200);
  });
}

/** Capture the map container as a canvas */
export async function captureMapCanvas(mapContainer: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(mapContainer, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    logging: false,
    // Capture only tiles, skip UI overlays
    ignoreElements: (el) => {
      const z = window.getComputedStyle(el).zIndex;
      return parseInt(z) >= 1000;
    },
  });
  return canvas;
}

/**
 * Convert lat/lng points to pixel coordinates on the captured canvas.
 */
export function geoToPixel(
  latlng: { lat: number; lng: number },
  map: any, // L.Map
  canvas: HTMLCanvasElement
): PixelPoint {
  const containerPoint = map.latLngToContainerPoint(latlng);
  // Scale if canvas resolution differs from container
  const container = map.getContainer();
  const scaleX = canvas.width / container.offsetWidth;
  const scaleY = canvas.height / container.offsetHeight;
  return {
    x: Math.round(containerPoint.x * scaleX),
    y: Math.round(containerPoint.y * scaleY),
  };
}

/**
 * Convert pixel coordinates back to lat/lng.
 */
export function pixelToGeo(
  px: PixelPoint,
  map: any,
  canvas: HTMLCanvasElement
): { lat: number; lng: number } {
  const container = map.getContainer();
  const scaleX = canvas.width / container.offsetWidth;
  const scaleY = canvas.height / container.offsetHeight;
  const containerPoint = { x: px.x / scaleX, y: px.y / scaleY };
  const latlng = map.containerPointToLatLng(containerPoint);
  return { lat: latlng.lat, lng: latlng.lng };
}

/**
 * Main segmentation pipeline:
 * 1. Load captured canvas into OpenCV Mat
 * 2. Build GrabCut mask from seed points
 * 3. Run GrabCut
 * 4. Refine with Canny edge detection
 * 5. Extract contours
 * 6. Convert to lat/lng polygon
 */
export function runSegmentation(
  canvas: HTMLCanvasElement,
  fgPixels: PixelPoint[],  // green seeds
  bgPixels: PixelPoint[],  // red seeds
  map: any
): SegmentationResult {
  const src = cv.imread(canvas);
  const width = src.cols;
  const height = src.rows;

  // --- Step 1: Create GrabCut mask ---
  // Initialize as GC_PR_BGD (probable background = 2)
  const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(2));

  // Mark foreground seed regions (GC_FGD = 1)
  const fgRadius = Math.max(3, Math.round(Math.min(width, height) * 0.012));
  for (const p of fgPixels) {
    cv.circle(mask, new cv.Point(p.x, p.y), fgRadius, new cv.Scalar(1), -1);
  }

  // Mark background seed regions (GC_BGD = 0)
  const bgRadius = Math.max(3, Math.round(Math.min(width, height) * 0.015));
  for (const p of bgPixels) {
    cv.circle(mask, new cv.Point(p.x, p.y), bgRadius, new cv.Scalar(0), -1);
  }

  // Also mark image borders as definite background
  const borderW = Math.max(2, Math.round(width * 0.02));
  cv.rectangle(mask, new cv.Point(0, 0), new cv.Point(width, borderW), new cv.Scalar(0), -1);
  cv.rectangle(mask, new cv.Point(0, height - borderW), new cv.Point(width, height), new cv.Scalar(0), -1);
  cv.rectangle(mask, new cv.Point(0, 0), new cv.Point(borderW, height), new cv.Scalar(0), -1);
  cv.rectangle(mask, new cv.Point(width - borderW, 0), new cv.Point(width, height), new cv.Scalar(0), -1);

  // --- Step 2: Run GrabCut ---
  const bgdModel = new cv.Mat();
  const fgdModel = new cv.Mat();
  const rect = new cv.Rect(0, 0, 1, 1); // not used in GC_INIT_WITH_MASK mode

  try {
    cv.grabCut(src, mask, rect, bgdModel, fgdModel, 5, cv.GC_INIT_WITH_MASK);
  } catch (e) {
    console.warn('GrabCut failed, falling back to color-distance method', e);
    // Fallback: use simple color distance from seeds
    return colorDistanceFallback(src, fgPixels, bgPixels, map, canvas, width, height);
  }

  // --- Step 3: Create binary mask (FGD + PR_FGD) ---
  const fgMask = new cv.Mat();
  // GC_FGD=1, GC_PR_FGD=3 → keep pixels where mask is 1 or 3
  const ones = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(1));
  const threes = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(3));
  const isFgd = new cv.Mat();
  const isPrFgd = new cv.Mat();
  cv.compare(mask, ones, isFgd, cv.CMP_EQ);
  cv.compare(mask, threes, isPrFgd, cv.CMP_EQ);
  cv.bitwise_or(isFgd, isPrFgd, fgMask);

  // --- Step 4: Refine with Canny edges ---
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 50, 150);

  // Dilate edges slightly to create edge barrier
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  const dilatedEdges = new cv.Mat();
  cv.dilate(edges, dilatedEdges, kernel);

  // Remove edge pixels from foreground mask (edges act as boundaries)
  const invertedEdges = new cv.Mat();
  cv.bitwise_not(dilatedEdges, invertedEdges);
  const refinedMask = new cv.Mat();
  cv.bitwise_and(fgMask, invertedEdges, refinedMask);

  // --- Step 5: Morphological cleanup ---
  const cleanKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(refinedMask, refinedMask, cv.MORPH_CLOSE, cleanKernel);
  cv.morphologyEx(refinedMask, refinedMask, cv.MORPH_OPEN, cleanKernel);

  // --- Step 6: Find contours ---
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(refinedMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_TC89_L1);

  // Find the largest contour that contains at least one foreground seed
  let bestIdx = -1;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area > bestArea) {
      // Check if any foreground seed is inside this contour
      for (const p of fgPixels) {
        const inside = cv.pointPolygonTest(cnt, new cv.Point(p.x, p.y), false);
        if (inside >= 0) {
          bestArea = area;
          bestIdx = i;
          break;
        }
      }
    }
  }

  let result: SegmentationResult;

  if (bestIdx >= 0) {
    const bestContour = contours.get(bestIdx);
    // Simplify with Douglas-Peucker
    const epsilon = 0.002 * cv.arcLength(bestContour, true);
    const simplified = new cv.Mat();
    cv.approxPolyDP(bestContour, simplified, epsilon, true);

    // Convert to lat/lng
    const ring: [number, number][] = [];
    for (let j = 0; j < simplified.rows; j++) {
      const px: PixelPoint = { x: simplified.intAt(j, 0), y: simplified.intAt(j, 1) };
      const geo = pixelToGeo(px, map, canvas);
      ring.push([geo.lat, geo.lng]);
    }
    // Close the ring
    if (ring.length > 0) {
      ring.push(ring[0]);
    }

    // Calculate confidence
    const totalPixels = width * height;
    const segRatio = bestArea / totalPixels;
    const seedDensity = Math.min(1, fgPixels.length / 5) * 20;
    const bgBonus = Math.min(1, bgPixels.length / 3) * 15;
    const sizeScore = (segRatio > 0.01 && segRatio < 0.7) ? 20 : 8;
    const edgeScore = 25; // GrabCut + Canny gives good edges
    const confidence = Math.min(97, Math.round(15 + seedDensity + bgBonus + sizeScore + edgeScore));

    result = { contourLatLngs: [ring], confidence };
    simplified.delete();
  } else {
    result = { contourLatLngs: [], confidence: 0 };
  }

  // Cleanup
  src.delete(); mask.delete(); bgdModel.delete(); fgdModel.delete();
  ones.delete(); threes.delete(); isFgd.delete(); isPrFgd.delete();
  fgMask.delete(); gray.delete(); edges.delete(); kernel.delete();
  dilatedEdges.delete(); invertedEdges.delete(); refinedMask.delete();
  cleanKernel.delete(); contours.delete(); hierarchy.delete();

  return result;
}

/**
 * Fallback: color-distance based region growing when GrabCut fails.
 * Still superior to circular buffers — grows based on color similarity.
 */
function colorDistanceFallback(
  src: any,
  fgPixels: PixelPoint[],
  bgPixels: PixelPoint[],
  map: any,
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): SegmentationResult {
  // Convert to LAB for better color distance
  const lab = new cv.Mat();
  cv.cvtColor(src, lab, cv.COLOR_RGBA2RGB);
  const labImg = new cv.Mat();
  cv.cvtColor(lab, labImg, cv.COLOR_RGB2Lab);

  // Get average foreground color
  let avgL = 0, avgA = 0, avgB = 0;
  for (const p of fgPixels) {
    const idx = (p.y * width + p.x) * 3;
    avgL += labImg.data[idx];
    avgA += labImg.data[idx + 1];
    avgB += labImg.data[idx + 2];
  }
  avgL /= fgPixels.length;
  avgA /= fgPixels.length;
  avgB /= fgPixels.length;

  // Create mask based on color distance
  const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(0));
  const threshold = 35; // LAB distance threshold

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const dL = labImg.data[idx] - avgL;
      const dA = labImg.data[idx + 1] - avgA;
      const dB = labImg.data[idx + 2] - avgB;
      const dist = Math.sqrt(dL * dL + dA * dA + dB * dB);
      if (dist < threshold) {
        mask.ucharPtr(y, x)[0] = 255;
      }
    }
  }

  // Remove background seed regions
  const bgRadius = Math.max(5, Math.round(Math.min(width, height) * 0.03));
  for (const p of bgPixels) {
    cv.circle(mask, new cv.Point(p.x, p.y), bgRadius, new cv.Scalar(0), -1);
  }

  // Canny edge barrier
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 50, 150);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2, 2));
  cv.dilate(edges, edges, kernel);
  const invertedEdges = new cv.Mat();
  cv.bitwise_not(edges, invertedEdges);
  cv.bitwise_and(mask, invertedEdges, mask);

  // Morphological cleanup
  const cleanKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, cleanKernel);
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, cleanKernel);

  // Contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_TC89_L1);

  let bestIdx = -1;
  let bestArea = 0;
  for (let i = 0; i < contours.size(); i++) {
    const area = cv.contourArea(contours.get(i));
    if (area > bestArea) {
      for (const p of fgPixels) {
        if (cv.pointPolygonTest(contours.get(i), new cv.Point(p.x, p.y), false) >= 0) {
          bestArea = area;
          bestIdx = i;
          break;
        }
      }
    }
  }

  let result: SegmentationResult;
  if (bestIdx >= 0) {
    const cnt = contours.get(bestIdx);
    const epsilon = 0.003 * cv.arcLength(cnt, true);
    const simplified = new cv.Mat();
    cv.approxPolyDP(cnt, simplified, epsilon, true);

    const ring: [number, number][] = [];
    for (let j = 0; j < simplified.rows; j++) {
      const geo = pixelToGeo({ x: simplified.intAt(j, 0), y: simplified.intAt(j, 1) }, map, canvas);
      ring.push([geo.lat, geo.lng]);
    }
    if (ring.length > 0) ring.push(ring[0]);

    const confidence = Math.min(85, Math.round(50 + Math.min(1, fgPixels.length / 5) * 20 + Math.min(1, bgPixels.length / 3) * 15));
    result = { contourLatLngs: [ring], confidence };
    simplified.delete();
  } else {
    result = { contourLatLngs: [], confidence: 0 };
  }

  lab.delete(); labImg.delete(); mask.delete(); gray.delete();
  edges.delete(); kernel.delete(); invertedEdges.delete();
  cleanKernel.delete(); contours.delete(); hierarchy.delete();
  src.delete();

  return result;
}
