import { useEffect, useMemo, useRef, useState } from 'react'
import type { Marker } from './GridModel'

type MarkerLayerProps = {
  markers: Marker[]
}

export const MarkerLayer = ({ markers }: MarkerLayerProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const rowTop = (row: number): string => `calc(${row} * var(--row-height) + var(--mirror-padding))`

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedIndex(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (selectedIndex === null) {
        return
      }

      const target = event.target as Node
      if (popoverRef.current?.contains(target)) {
        return
      }

      if (layerRef.current?.contains(target)) {
        return
      }

      setSelectedIndex(null)
    }

    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [selectedIndex])

  const selectedMarker = useMemo(() => {
    if (selectedIndex === null) {
      return null
    }

    return markers[selectedIndex] ?? null
  }, [markers, selectedIndex])

  return (
    <>
      <div className="marker-layer" aria-hidden ref={layerRef}>
        {markers.map((marker, index) => (
          <button
            key={`${marker.row}-${index}`}
            className="marker-dot"
            style={{ top: rowTop(marker.row) }}
            onClick={() => setSelectedIndex(index)}
            title="View full translation"
          >
            •
          </button>
        ))}
      </div>

      {selectedMarker && (
        <div
          className="marker-popover"
          style={{ top: rowTop(selectedMarker.row) }}
          role="dialog"
          aria-label="Full translation"
          ref={popoverRef}
        >
          <div className="popover-label">中文</div>
          <div className="popover-body">{selectedMarker.fullText}</div>
          <div className="popover-label">Original</div>
          <div className="popover-body popover-source">{selectedMarker.source}</div>
        </div>
      )}
    </>
  )
}
