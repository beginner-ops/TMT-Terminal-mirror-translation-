import { useState } from 'react'
import type { DebugStats } from '../mirror/GridModel'

type DebugToggleProps = {
  stats: DebugStats
  glossaryPath: string
  glossaryEntryCount: number
  glossaryStatus: string
  onReloadGlossary: () => void
  onImportGlossary: () => void
  onExportGlossary: () => void
}

export const DebugToggle = ({
  stats,
  glossaryPath,
  glossaryEntryCount,
  glossaryStatus,
  onReloadGlossary,
  onImportGlossary,
  onExportGlossary,
}: DebugToggleProps) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="debug-wrap">
      <button className="debug-button" onClick={() => setOpen((prev) => !prev)}>
        Debug
      </button>
      {open && (
        <div className="debug-popover" role="dialog" aria-label="Debug stats">
          <div>scanRuns: {stats.scanRuns}</div>
          <div>candidatesFound: {stats.candidatesFound}</div>
          <div>matchedPhrasesCount: {stats.matchedPhrasesCount}</div>
          <div>glossaryHits: {stats.glossaryHits}</div>
          <div>rulesHits: {stats.rulesHits}</div>
          <div>translatedCount: {stats.translatedCount}</div>
          <div>markersRendered: {stats.markersRendered}</div>
          <div>topSkipReasons: {stats.topSkipReasons.join(', ') || 'none'}</div>
          <div>glossaryEntries: {glossaryEntryCount}</div>
          <div className="debug-glossary-path" title={glossaryPath}>
            glossaryPath: {glossaryPath}
          </div>
          <div>glossaryStatus: {glossaryStatus}</div>
          <div className="debug-actions">
            <button className="debug-action-button" onClick={onReloadGlossary}>
              Reload
            </button>
            <button className="debug-action-button" onClick={onImportGlossary}>
              Import
            </button>
            <button className="debug-action-button" onClick={onExportGlossary}>
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
