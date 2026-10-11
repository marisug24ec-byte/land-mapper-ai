import { useRef, useState, useCallback, useEffect } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { Pentagon, Square, Circle, Pencil, Trash2, RotateCcw, Navigation, Check, X, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMapSetup } from '../hooks/useMapSetup';
import { PageNav } from '../components/PageNav';
import { SearchPanel } from '../components/SearchPanel';
import { LandDetailsPanel } from '../components/LandDetailsPanel';
import { ResultsPanel } from '../components/ResultsPanel';
import {
  MapType,
  Measurement,
  coordsToMeasurement,
  circleMeasurement,
  exportPdf,
  saveProject,
} from '../utils/mapHelpers';

type DrawMode = 'none' | 'polygon' | 'rectangle' | 'circle' | 'edit';

const ManualDraw = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const {
    mapRef, mapType, setMapType, handleZoom, handleLocateMe, statusText, setStatusText,
  } = useMapSetup(mapContainerRef);

  const drawnLayersRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const tempLayersRef = useRef<L.LayerGroup>(new L.LayerGroup());
  const editMarkersRef = useRef<L.LayerGroup>(new L.LayerGroup());

  const drawPointsRef = useRef<L.LatLng[]>([]);
  const rectCornerRef = useRef<L.LatLng | null>(null);
  const circleCenterRef = useRef<L.LatLng | null>(null);
  const selectedLayerRef = useRef<L.Layer | null>(null);
  const shapeClickedRef = useRef(false);

  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPointCount, setDrawPointCount] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // Add layers to map once
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const checkMap = setInterval(() => {
      if (mapRef.current) {
        drawnLayersRef.current.addTo(mapRef.current);
        tempLayersRef.current.addTo(mapRef.current);
        editMarkersRef.current.addTo(mapRef.current);
        clearInterval(checkMap);
      }
    }, 100);
    return () => clearInterval(checkMap);
  }, [mapRef]);

  // Shape selection
  const selectShape = useCallback((layer: L.Layer) => {
    // Deselect previous
    if (selectedLayerRef.current && selectedLayerRef.current !== layer) {
      (selectedLayerRef.current as any).setStyle?.({ color: '#3b82f6', weight: 2 });
    }
    selectedLayerRef.current = layer;
    (layer as any).setStyle?.({ color: '#f59e0b', weight: 3 });
    setHasSelection(true);
    editMarkersRef.current.clearLayers();

    // If in edit mode, show vertex markers
    if (drawMode === 'edit' && (layer instanceof L.Polygon || layer instanceof L.Rectangle)) {
      const latLngs = (layer as L.Polygon).getLatLngs()[0] as L.LatLng[];
      latLngs.forEach((vertex, i) => {
        const icon = L.divIcon({ className: 'vertex-marker', iconSize: [12, 12], iconAnchor: [6, 6] });
        const marker = L.marker(vertex, { icon, draggable: true });
        marker.on('drag', () => {
          latLngs[i] = marker.getLatLng();
          (layer as L.Polygon).setLatLngs(latLngs);
          const m = coordsToMeasurement(latLngs, 88);
          if (m) setMeasurement(m);
        });
        editMarkersRef.current.addLayer(marker);
      });
    }
  }, [drawMode]);

  const deselectShape = useCallback(() => {
    if (selectedLayerRef.current) {
      (selectedLayerRef.current as any).setStyle?.({ color: '#3b82f6', weight: 2 });
      selectedLayerRef.current = null;
    }
    editMarkersRef.current.clearLayers();
    setHasSelection(false);
  }, []);

  const addShapeClickHandler = useCallback((layer: L.Layer) => {
    layer.on('click', () => {
      shapeClickedRef.current = true;
      selectShape(layer);
    });
  }, [selectShape]);

  // Disable double-click zoom during drawing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode === 'polygon' || drawMode === 'rectangle' || drawMode === 'circle') {
      map.doubleClickZoom.disable();
      map.dragging.disable();
    } else {
      // Always re-enable when not actively drawing
      map.doubleClickZoom.enable();
      map.dragging.enable();
    }
    return () => {
      if (map) {
        map.doubleClickZoom.enable();
        map.dragging.enable();
      }
    };
  }, [drawMode, mapRef]);

  // Prevent duplicate vertices helper
  const isDuplicateVertex = useCallback((latlng: L.LatLng): boolean => {
    const pts = drawPointsRef.current;
    if (pts.length === 0) return false;
    const last = pts[pts.length - 1];
    return last.distanceTo(latlng) < 2; // within 2 meters
  }, []);

  // Validate polygon self-intersection using turf.kinks
  const hasSelfIntersection = useCallback((coords: L.LatLng[]): boolean => {
    if (coords.length < 4) return false;
    try {
      const ring = coords.map(c => [c.lng, c.lat]);
      ring.push([coords[0].lng, coords[0].lat]);
      const poly = turf.polygon([ring]);
      const kinks = turf.kinks(poly);
      return kinks.features.length > 0;
    } catch { return false; }
  }, []);

  const resetDrawing = useCallback(() => {
    tempLayersRef.current.clearLayers();
    drawPointsRef.current = [];
    rectCornerRef.current = null;
    circleCenterRef.current = null;
    setIsDrawing(false);
    setDrawPointCount(0);
  }, []);

  const finishPolygon = useCallback(() => {
    if (drawPointsRef.current.length < 3) return;
    if (hasSelfIntersection(drawPointsRef.current)) {
      setStatusText('⚠ Invalid: polygon self-intersects. Remove crossing vertices.');
      return;
    }
    const polygon = L.polygon(drawPointsRef.current, { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 });
    drawnLayersRef.current.addLayer(polygon);
    addShapeClickHandler(polygon);
    setMeasurement(coordsToMeasurement(drawPointsRef.current, 90));
    resetDrawing();
    setDrawMode('none');
    setStatusText('Polygon created');
  }, [addShapeClickHandler, resetDrawing, setStatusText, hasSelfIntersection]);

  // Click / mousemove handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (shapeClickedRef.current) {
        shapeClickedRef.current = false;
        return;
      }

      switch (drawMode) {
        case 'polygon': {
          if (isDuplicateVertex(e.latlng)) return;
          const pts = drawPointsRef.current;
          if (pts.length >= 3) {
            const first = pts[0];
            const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(first));
            if (dist < 15) {
              finishPolygon();
              return;
            }
          }
          drawPointsRef.current.push(e.latlng);
          setDrawPointCount(drawPointsRef.current.length);
          setIsDrawing(true);
          L.circleMarker(e.latlng, { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 })
            .addTo(tempLayersRef.current);
          setStatusText(`Polygon: ${drawPointsRef.current.length} vertices — click first point or Finish to close`);
          break;
        }
        case 'rectangle': {
          if (!rectCornerRef.current) {
            rectCornerRef.current = e.latlng;
            L.circleMarker(e.latlng, { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 })
              .addTo(tempLayersRef.current);
            setIsDrawing(true);
            setStatusText('Click second corner');
          } else {
            const bounds = L.latLngBounds(rectCornerRef.current, e.latlng);
            const rect = L.rectangle(bounds, { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 });
            drawnLayersRef.current.addLayer(rect);
            addShapeClickHandler(rect);
            const corners = [bounds.getSouthWest(), bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthEast()];
            setMeasurement(coordsToMeasurement(corners, 95));
            resetDrawing();
            setDrawMode('none');
            setStatusText('Rectangle created');
          }
          break;
        }
        case 'circle': {
          if (!circleCenterRef.current) {
            circleCenterRef.current = e.latlng;
            L.circleMarker(e.latlng, { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 })
              .addTo(tempLayersRef.current);
            setIsDrawing(true);
            setStatusText('Click to set radius');
          } else {
            const radius = circleCenterRef.current.distanceTo(e.latlng);
            const circle = L.circle(circleCenterRef.current, { radius, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 });
            drawnLayersRef.current.addLayer(circle);
            addShapeClickHandler(circle);
            setMeasurement(circleMeasurement(radius));
            resetDrawing();
            setDrawMode('none');
            setStatusText('Circle created');
          }
          break;
        }
        case 'none':
        case 'edit':
          deselectShape();
          break;
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      tempLayersRef.current.eachLayer((l) => { if ((l as any)._isPreview) tempLayersRef.current.removeLayer(l); });

      if (drawMode === 'polygon' && drawPointsRef.current.length > 0) {
        const pts = [...drawPointsRef.current, e.latlng];
        const line = L.polyline(pts, { color: '#3b82f6', weight: 2, dashArray: '6 4', opacity: 0.7 });
        (line as any)._isPreview = true;
        line.addTo(tempLayersRef.current);

        if (drawPointsRef.current.length >= 3) {
          const first = drawPointsRef.current[0];
          const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(first));
          if (dist < 15) {
            const snap = L.circleMarker(first, { radius: 8, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.6, weight: 2 });
            (snap as any)._isPreview = true;
            snap.addTo(tempLayersRef.current);
          }
        }
      } else if (drawMode === 'rectangle' && rectCornerRef.current) {
        const bounds = L.latLngBounds(rectCornerRef.current, e.latlng);
        const rect = L.rectangle(bounds, { color: '#3b82f6', weight: 2, dashArray: '6 4', fillOpacity: 0.1 });
        (rect as any)._isPreview = true;
        rect.addTo(tempLayersRef.current);
      } else if (drawMode === 'circle' && circleCenterRef.current) {
        const radius = circleCenterRef.current.distanceTo(e.latlng);
        const circle = L.circle(circleCenterRef.current, { radius, color: '#3b82f6', weight: 2, dashArray: '6 4', fillOpacity: 0.1 });
        (circle as any)._isPreview = true;
        circle.addTo(tempLayersRef.current);
      }
    };

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);

    const container = map.getContainer();
    container.style.cursor = drawMode !== 'none' && drawMode !== 'edit' ? 'crosshair' : '';

    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      container.style.cursor = '';
    };
  }, [drawMode, mapRef, addShapeClickHandler, deselectShape, setStatusText, isDuplicateVertex, finishPolygon, resetDrawing]);

  const handleModeChange = useCallback((mode: DrawMode) => {
    resetDrawing();
    deselectShape();
    setDrawMode(prev => prev === mode ? 'none' : mode);
    const labels: Record<DrawMode, string> = {
      none: '', polygon: 'Click to place polygon vertices', rectangle: 'Click first corner',
      circle: 'Click center of circle', edit: 'Click a shape to edit vertices',
    };
    setStatusText(labels[mode === drawMode ? 'none' : mode]);
  }, [drawMode, resetDrawing, deselectShape, setStatusText]);

  const handleDelete = useCallback(() => {
    if (selectedLayerRef.current) {
      drawnLayersRef.current.removeLayer(selectedLayerRef.current);
      selectedLayerRef.current = null;
      editMarkersRef.current.clearLayers();
      setHasSelection(false);
      setMeasurement(null);
      setStatusText('Shape deleted');
    }
  }, [setStatusText]);

  const handleClear = useCallback(() => {
    drawnLayersRef.current.clearLayers();
    tempLayersRef.current.clearLayers();
    editMarkersRef.current.clearLayers();
    selectedLayerRef.current = null;
    drawPointsRef.current = [];
    rectCornerRef.current = null;
    circleCenterRef.current = null;
    setMeasurement(null);
    setIsDrawing(false);
    setDrawPointCount(0);
    setHasSelection(false);
    setDrawMode('none');
    setStatusText('All cleared');
  }, [setStatusText]);

  const handleSave = useCallback(() => {
    const layers: any[] = [];
    drawnLayersRef.current.eachLayer((layer) => {
      if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
        layers.push({ type: 'polygon', coords: (layer as L.Polygon).getLatLngs()[0] });
      } else if (layer instanceof L.Circle) {
        layers.push({ type: 'circle', center: (layer as L.Circle).getLatLng(), radius: (layer as L.Circle).getRadius() });
      }
    });
    saveProject(layers, measurement, 'manual');
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2000);
    setStatusText('Project saved');
  }, [measurement, setStatusText]);

  const handleExport = useCallback(() => {
    if (measurement) { exportPdf(measurement); setStatusText('PDF exported'); }
  }, [measurement, setStatusText]);

  // Toolbar button helper
  const ToolBtn = ({ icon, label, active, onClick, disabled, variant }: {
    icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
    variant?: 'danger' | 'success';
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'bg-primary text-primary-foreground shadow-md'
          : variant === 'danger'
          ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
          : variant === 'success'
          ? 'bg-success text-success-foreground shadow-md animate-pulse-glow'
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
      <LandDetailsPanel mapRef={mapRef as React.RefObject<L.Map | null>} enabled={drawMode === 'none'} />

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
          <p className="text-[9px] text-muted-foreground">Draw Site Boundary</p>
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
          <ToolBtn icon={<Pentagon size={18} />} label="Polygon" active={drawMode === 'polygon'} onClick={() => handleModeChange('polygon')} />
          <ToolBtn icon={<Square size={18} />} label="Rectangle" active={drawMode === 'rectangle'} onClick={() => handleModeChange('rectangle')} />
          <ToolBtn icon={<Circle size={18} />} label="Circle" active={drawMode === 'circle'} onClick={() => handleModeChange('circle')} />
          <div className="h-px bg-border mx-1 my-0.5" />
          <ToolBtn icon={<Pencil size={18} />} label="Edit Vertices" active={drawMode === 'edit'} onClick={() => handleModeChange('edit')} />
          <ToolBtn icon={<Trash2 size={18} />} label="Delete Selected" onClick={handleDelete} disabled={!hasSelection} variant="danger" />
          <ToolBtn icon={<RotateCcw size={18} />} label="Clear All" onClick={handleClear} />
          <div className="h-px bg-border mx-1 my-0.5" />
          <ToolBtn icon={<Navigation size={18} />} label="Locate Me" onClick={handleLocateMe} />

          {isDrawing && drawPointCount >= 3 && (
            <>
              <div className="h-px bg-border mx-1 my-0.5" />
              <ToolBtn icon={<Check size={18} />} label="Finish Polygon" onClick={finishPolygon} variant="success" />
            </>
          )}
          {isDrawing && (
            <ToolBtn icon={<X size={18} />} label="Cancel" onClick={() => { resetDrawing(); setDrawMode('none'); setStatusText(''); }} variant="danger" />
          )}
        </div>
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

      {/* Status */}
      {statusText && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel rounded-full px-4 py-1.5 text-xs text-muted-foreground">{statusText}</div>
        </div>
      )}
    </div>
  );
};

export default ManualDraw;
