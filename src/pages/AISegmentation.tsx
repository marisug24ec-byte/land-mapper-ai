import { useRef, useState, useCallback, useEffect } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { MapPin, MinusCircle, Pencil, RotateCcw, Navigation, Check, Loader2, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMapSetup } from '../hooks/useMapSetup';
import { PageNav } from '../components/PageNav';
import { SearchPanel } from '../components/SearchPanel';
import { LandDetailsPanel } from '../components/LandDetailsPanel';
import { ResultsPanel } from '../components/ResultsPanel';
import {
  MapType,
  Measurement,
  exportPdf,
  saveProject,
} from '../utils/mapHelpers';
import {
  waitForOpenCV,
  captureMapCanvas,
  geoToPixel,
  runSegmentation,
} from '../utils/cvSegmentation';

type SegMode = 'none' | 'include' | 'exclude' | 'edit';

const AISegmentation = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const {
    mapRef, mapType, setMapType, handleZoom, handleLocateMe, statusText, setStatusText,
  } = useMapSetup(mapContainerRef);

  const segLayerRef = useRef<L.GeoJSON | null>(null);
  const segMarkersRef = useRef<L.LayerGroup>(new L.LayerGroup());
  const editMarkersRef = useRef<L.LayerGroup>(new L.LayerGroup());
  const editablePolyRef = useRef<L.Polygon | null>(null);

  // Seed points stored as LatLng
  const greenPointsRef = useRef<L.LatLng[]>([]);
  const redPointsRef = useRef<L.LatLng[]>([]);
  const isConfirmedRef = useRef(false);

  const [segMode, setSegMode] = useState<SegMode>('none');
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [pointCount, setPointCount] = useState({ include: 0, exclude: 0 });
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cvReady, setCvReady] = useState(false);

  // Load OpenCV.js
  useEffect(() => {
    waitForOpenCV(30000)
      .then(() => setCvReady(true))
      .catch(() => setStatusText('OpenCV.js failed to load — using fallback'));
  }, [setStatusText]);

  // Add marker layers to map
  useEffect(() => {
    const checkMap = setInterval(() => {
      if (mapRef.current) {
        segMarkersRef.current.addTo(mapRef.current);
        editMarkersRef.current.addTo(mapRef.current);
        clearInterval(checkMap);
      }
    }, 100);
    return () => clearInterval(checkMap);
  }, [mapRef]);

  // Click handler for placing seed points
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (isConfirmedRef.current && segMode !== 'edit') return;

      if (segMode === 'include') {
        L.circleMarker(e.latlng, {
          radius: 8, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8, weight: 2,
        }).addTo(segMarkersRef.current);
        greenPointsRef.current.push(e.latlng);
        setPointCount(p => ({ ...p, include: p.include + 1 }));
        setStatusText(`Include points: ${greenPointsRef.current.length} — add more or click Segment`);
      } else if (segMode === 'exclude') {
        L.circleMarker(e.latlng, {
          radius: 8, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.8, weight: 2,
        }).addTo(segMarkersRef.current);
        redPointsRef.current.push(e.latlng);
        setPointCount(p => ({ ...p, exclude: p.exclude + 1 }));
        setStatusText(`Exclude points: ${redPointsRef.current.length}`);
      }
    };

    map.on('click', onClick);
    const container = map.getContainer();
    container.style.cursor = (segMode === 'include' || segMode === 'exclude') ? 'crosshair' : '';

    return () => {
      map.off('click', onClick);
      container.style.cursor = '';
    };
  }, [segMode, mapRef, setStatusText]);

  /** Run the real CV segmentation pipeline */
  const handleRunSegmentation = useCallback(async () => {
    const map = mapRef.current;
    if (!map || greenPointsRef.current.length === 0) return;
    if (!mapContainerRef.current) return;

    setIsProcessing(true);
    setStatusText('Capturing map image...');

    try {
      // Step 1: Capture map as canvas
      const canvas = await captureMapCanvas(mapContainerRef.current);

      // Step 2: Convert seed points to pixel coordinates
      const fgPixels = greenPointsRef.current.map(ll => geoToPixel(ll, map, canvas));
      const bgPixels = redPointsRef.current.map(ll => geoToPixel(ll, map, canvas));

      setStatusText('Running AI segmentation (GrabCut + Edge Detection)...');

      // Step 3: Run segmentation (async-friendly via setTimeout to not block UI)
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      const result = runSegmentation(canvas, fgPixels, bgPixels, map);

      if (result.contourLatLngs.length === 0 || result.contourLatLngs[0].length < 4) {
        setStatusText('Segmentation found no boundary. Try more seed points or zoom closer.');
        setIsProcessing(false);
        return;
      }

      // Step 4: Remove old layer
      if (segLayerRef.current) {
        map.removeLayer(segLayerRef.current);
        segLayerRef.current = null;
      }

      // Step 5: Create GeoJSON from contour
      const ring = result.contourLatLngs[0].map(([lat, lng]) => [lng, lat]); // GeoJSON is [lng, lat]
      const geoJsonPoly = turf.polygon([ring]);

      segLayerRef.current = L.geoJSON(geoJsonPoly, {
        style: { color: '#14b8a6', fillColor: '#14b8a6', fillOpacity: 0.25, weight: 2 },
      });
      segLayerRef.current.addTo(map);

      // Step 6: Calculate measurements
      const area = turf.area(geoJsonPoly);
      const line = turf.polygonToLine(geoJsonPoly);
      const perimeter = turf.length(line, { units: 'meters' });
      setMeasurement({
        areaSqm: area,
        areaAcres: area * 0.000247105,
        areaHectares: area * 0.0001,
        perimeterM: perimeter,
        confidence: result.confidence,
      });

      setStatusText(`Segmentation complete — ${result.confidence}% confidence`);
    } catch (err: any) {
      console.error('Segmentation error:', err);
      setStatusText(`Segmentation failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [mapRef, setStatusText]);

  const handleConfirmSegmentation = useCallback(() => {
    if (!segLayerRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    isConfirmedRef.current = true;
    setIsConfirmed(true);
    setSegMode('none');

    // Convert to editable polygon
    map.removeLayer(segLayerRef.current);
    const geoLayer = segLayerRef.current;
    segLayerRef.current = null;

    geoLayer.eachLayer((layer) => {
      if (layer instanceof L.Polygon) {
        editablePolyRef.current = L.polygon(layer.getLatLngs() as L.LatLng[][], {
          color: '#14b8a6', fillColor: '#14b8a6', fillOpacity: 0.25, weight: 2,
        });
        editablePolyRef.current.addTo(map);
      }
    });

    setStatusText('Segmentation confirmed. Use Edit to adjust vertices.');
  }, [mapRef, setStatusText]);

  const handleEditMode = useCallback(() => {
    if (!editablePolyRef.current || !mapRef.current) return;
    setSegMode('edit');
    editMarkersRef.current.clearLayers();

    const latLngs = editablePolyRef.current.getLatLngs()[0] as L.LatLng[];
    latLngs.forEach((vertex, i) => {
      const icon = L.divIcon({ className: 'vertex-marker', iconSize: [12, 12], iconAnchor: [6, 6] });
      const marker = L.marker(vertex, { icon, draggable: true });
      marker.on('drag', () => {
        latLngs[i] = marker.getLatLng();
        editablePolyRef.current!.setLatLngs(latLngs);
        try {
          const ring = latLngs.map(c => [c.lng, c.lat]);
          ring.push([latLngs[0].lng, latLngs[0].lat]);
          const poly = turf.polygon([ring]);
          const area = turf.area(poly);
          const perim = turf.length(turf.lineString(ring), { units: 'meters' });
          setMeasurement(prev => ({
            areaSqm: area, areaAcres: area * 0.000247105, areaHectares: area * 0.0001,
            perimeterM: perim, confidence: prev?.confidence ?? 85,
          }));
        } catch { /* skip */ }
      });
      editMarkersRef.current.addLayer(marker);
    });
    setStatusText('Drag vertices to refine boundary');
  }, [mapRef, setStatusText]);

  const handleModeChange = useCallback((mode: SegMode) => {
    if (mode === 'edit') {
      handleEditMode();
      return;
    }
    editMarkersRef.current.clearLayers();
    setSegMode(prev => prev === mode ? 'none' : mode);
    const labels: Record<SegMode, string> = {
      none: '', include: 'Click to place green seed point', exclude: 'Click to place red exclusion point', edit: '',
    };
    setStatusText(labels[mode === segMode ? 'none' : mode]);
  }, [segMode, handleEditMode, setStatusText]);

  const handleClear = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    segMarkersRef.current.clearLayers();
    editMarkersRef.current.clearLayers();
    if (segLayerRef.current) { map.removeLayer(segLayerRef.current); segLayerRef.current = null; }
    if (editablePolyRef.current) { map.removeLayer(editablePolyRef.current); editablePolyRef.current = null; }
    greenPointsRef.current = [];
    redPointsRef.current = [];
    isConfirmedRef.current = false;
    setIsConfirmed(false);
    setMeasurement(null);
    setPointCount({ include: 0, exclude: 0 });
    setSegMode('none');
    setStatusText('All cleared');
  }, [mapRef, setStatusText]);

  const handleSave = useCallback(() => {
    const layers: any[] = [];
    if (editablePolyRef.current) {
      const latlngs = editablePolyRef.current.getLatLngs();
      layers.push({ type: 'segmentation', latlngs });
    }
    saveProject(layers, measurement, 'ai-segmentation');
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2000);
    setStatusText('Project saved');
  }, [measurement, setStatusText]);

  const handleExport = useCallback(() => {
    if (measurement) { exportPdf(measurement); setStatusText('PDF exported'); }
  }, [measurement, setStatusText]);

  const ToolBtn = ({ icon, label, active, onClick, disabled, variant }: {
    icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
    variant?: 'danger' | 'success' | 'include' | 'exclude' | 'primary';
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? variant === 'include' ? 'bg-success text-success-foreground shadow-md'
          : variant === 'exclude' ? 'bg-destructive text-destructive-foreground shadow-md'
          : 'bg-primary text-primary-foreground shadow-md'
          : variant === 'success' ? 'bg-success text-success-foreground shadow-md animate-pulse'
          : variant === 'primary' ? 'bg-primary text-primary-foreground shadow-md'
          : variant === 'danger' ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      <PageNav />
      <SearchPanel mapRef={mapRef as React.RefObject<L.Map | null>} setStatusText={setStatusText} />
      <LandDetailsPanel mapRef={mapRef as React.RefObject<L.Map | null>} enabled={segMode === 'none'} />

      {/* Back to Home + Title */}
      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-2">
        <button
          onClick={() => { handleClear(); navigate('/'); }}
          className="glass-panel rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Home size={14} />
          Back to Home
        </button>
        <div className="glass-panel rounded-xl px-3 py-2">
          <h1 className="text-base font-bold text-primary tracking-tight">AL-Scout 3D</h1>
          <p className="text-[9px] text-muted-foreground">AI Vision Segmentation</p>
        </div>
      </div>

      {/* Map Type + Zoom */}
      <div className="absolute top-16 right-4 z-[1000] space-y-2">
        <div className="glass-panel rounded-xl p-1 flex gap-1">
          {(['normal', 'satellite', 'terrain', 'bhuvan'] as MapType[]).map((type) => (
            <button key={type} onClick={() => setMapType(type)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                mapType === type ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >{type === 'bhuvan' ? 'Bhuvan' : type.charAt(0).toUpperCase() + type.slice(1)}</button>
          ))}
        </div>
        <div className="glass-panel rounded-xl flex flex-col overflow-hidden">
          <button onClick={() => handleZoom(1)} className="px-3 py-1.5 text-foreground hover:bg-secondary transition-colors text-base font-bold">+</button>
          <div className="h-px bg-border" />
          <button onClick={() => handleZoom(-1)} className="px-3 py-1.5 text-foreground hover:bg-secondary transition-colors text-base font-bold">−</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-[1000]">
        <div className="glass-panel rounded-xl p-1.5 flex flex-col gap-1">
          <ToolBtn icon={<MapPin size={18} />} label="Include Point (Green)" active={segMode === 'include'} onClick={() => handleModeChange('include')} variant="include" disabled={isConfirmed} />
          <ToolBtn icon={<MinusCircle size={18} />} label="Exclude Point (Red)" active={segMode === 'exclude'} onClick={() => handleModeChange('exclude')} variant="exclude" disabled={isConfirmed} />
          <div className="h-px bg-border mx-1 my-0.5" />

          {/* Run Segmentation button — replaces old auto-buffer */}
          {!isConfirmed && pointCount.include > 0 && (
            <ToolBtn
              icon={isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              label="Run AI Segmentation"
              onClick={handleRunSegmentation}
              variant="primary"
              disabled={isProcessing}
            />
          )}

          {/* Confirm after segmentation result is shown */}
          {!isConfirmed && measurement && !isProcessing && (
            <ToolBtn icon={<Check size={18} />} label="Confirm & Lock" onClick={handleConfirmSegmentation} variant="success" />
          )}

          {isConfirmed && (
            <ToolBtn icon={<Pencil size={18} />} label="Edit Vertices" active={segMode === 'edit'} onClick={() => handleModeChange('edit')} />
          )}

          <ToolBtn icon={<RotateCcw size={18} />} label="Clear All" onClick={handleClear} />
          <div className="h-px bg-border mx-1 my-0.5" />
          <ToolBtn icon={<Navigation size={18} />} label="Locate Me" onClick={handleLocateMe} />
        </div>

        {/* Point counter */}
        {(pointCount.include > 0 || pointCount.exclude > 0) && (
          <div className="glass-panel rounded-lg p-2 mt-2 text-[10px] space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success inline-block" />
              <span className="text-muted-foreground">Include: {pointCount.include}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
              <span className="text-muted-foreground">Exclude: {pointCount.exclude}</span>
            </div>
          </div>
        )}

        {/* OpenCV status */}
        {!cvReady && (
          <div className="glass-panel rounded-lg p-2 mt-2 text-[10px] flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-primary" />
            <span className="text-muted-foreground">Loading OpenCV.js...</span>
          </div>
        )}
      </div>

      {/* Results */}
      {measurement && (
        <ResultsPanel
          measurement={measurement}
          showDisclaimer={showDisclaimer}
          onToggleDisclaimer={() => setShowDisclaimer(!showDisclaimer)}
          onSave={handleSave}
          onExport={handleExport}
          onClear={handleClear}
          showSaveSuccess={showSaveSuccess}
        />
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div className="absolute inset-0 z-[1500] flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="glass-panel rounded-2xl p-6 flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-primary" />
            <p className="text-sm text-foreground font-medium">Running AI Segmentation...</p>
            <p className="text-xs text-muted-foreground">GrabCut + Canny Edge Detection</p>
          </div>
        </div>
      )}

      {/* Status */}
      {statusText && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel rounded-full px-4 py-1.5 text-xs text-muted-foreground">{statusText}</div>
        </div>
      )}
    </div>
  );
};

export default AISegmentation;
