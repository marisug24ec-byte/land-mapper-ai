import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { TILE_CONFIGS, MapType } from '../utils/mapHelpers';

export function useMapSetup(containerRef: React.RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const wmsLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const tileErrorShownRef = useRef(false);
  const locateLayerRef = useRef<L.LayerGroup>(new L.LayerGroup());
  const [mapType, setMapType] = useState<MapType>('normal');
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 3,
      zoomControl: false,
      doubleClickZoom: false,
      attributionControl: true,
    });

    const config = TILE_CONFIGS['normal'];
    const tile = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 19,
    });

    tile.on('tileerror', () => {
      if (!tileErrorShownRef.current && mapType !== 'normal') {
        tileErrorShownRef.current = true;
        toast.error('Satellite imagery temporarily unavailable, switching to OpenStreetMap');
        setMapType('normal');
      }
    });

    tile.addTo(map);
    tileLayerRef.current = tile;
    locateLayerRef.current.addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const config = TILE_CONFIGS[mapType];

    // Remove old WMS layer if present
    if (wmsLayerRef.current) {
      map.removeLayer(wmsLayerRef.current);
      wmsLayerRef.current = null;
    }

    if (config.isWms) {
      // For Bhuvan WMS, keep the current tile layer and add WMS overlay
      if (tileLayerRef.current) {
        // Switch base to satellite for better context under WMS
        const satConfig = TILE_CONFIGS['satellite'];
        tileLayerRef.current.setUrl(satConfig.url);
      }
      try {
        wmsLayerRef.current = L.tileLayer.wms(config.url, {
          layers: config.layers || 'india3',
          format: 'image/png',
          transparent: true,
          attribution: config.attribution,
        });
        wmsLayerRef.current.addTo(map);
        wmsLayerRef.current.on('tileerror', () => {
          toast.error('Bhuvan WMS layer unavailable. Cadastral data may not be accessible.');
        });
      } catch {
        toast.error('Failed to load Bhuvan WMS layer');
      }
    } else {
      if (tileLayerRef.current) {
        tileLayerRef.current.setUrl(config.url);
      }
    }
    tileErrorShownRef.current = false;
  }, [mapType]);

  const handleZoom = useCallback((delta: number) => {
    const map = mapRef.current;
    if (map) map.setZoom(map.getZoom() + delta);
  }, []);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setStatusText('Geolocation not supported');
      return;
    }
    setStatusText('Getting location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        const { latitude, longitude, accuracy } = pos.coords;
        const ll = L.latLng(latitude, longitude);
        locateLayerRef.current.clearLayers();
        L.circle(ll, {
          radius: accuracy, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1,
        }).addTo(locateLayerRef.current);
        L.circleMarker(ll, {
          radius: 8, color: '#3b82f6', fillColor: '#60a5fa', fillOpacity: 1, weight: 3,
        }).addTo(locateLayerRef.current);
        map.setView(ll, 16);
        setStatusText(`Located: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      },
      (err) => {
        setStatusText(err.code === 1 ? 'Location permission denied' : 'Could not get location');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { mapRef, mapType, setMapType, handleZoom, handleLocateMe, statusText, setStatusText, locateLayerRef };
}
