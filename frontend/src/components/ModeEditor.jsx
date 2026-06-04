import { useState } from 'react'
import { BUILTIN_MODES, CHECK_TEMPLATES, loadCustomModes, saveCustomModes } from '../modes'

function uid() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export default function ModeEditor({ currentModeId, onClose, onSelectMode }) {
  const [customModes, setCustomModes] = useState(loadCustomModes)
  const [selectedId, setSelectedId]   = useState(currentModeId)
  const [showPicker, setShowPicker]   = useState(false)

  const allModes = [...BUILTIN_MODES, ...customModes]
  const selected  = allModes.find((m) => m.id === selectedId) ?? allModes[0]
  const isBuiltin = !!selected.builtin

  // ── Persistence helpers ─────────────────────────────────────────────────────

  function persistCustom(next) {
    setCustomModes(next)
    saveCustomModes(next)
  }

  function updateSelected(updated) {
    persistCustom(customModes.map((m) => (m.id === updated.id ? updated : m)))
  }

  // ── Mode-level operations ───────────────────────────────────────────────────

  function addMode() {
    const id = `custom_${Date.now()}`
    const fresh = {
      id,
      name: 'New Mode',
      builtin: false,
      checks: [{ id: uid(), ...CHECK_TEMPLATES[0], enabled: true }],
    }
    persistCustom([...customModes, fresh])
    setSelectedId(id)
  }

  function duplicateMode() {
    const id = `custom_${Date.now()}`
    const copy = {
      ...selected,
      id,
      name: `${selected.name} (copy)`,
      builtin: false,
      checks: selected.checks.map((c) => ({ ...c, id: uid() })),
    }
    persistCustom([...customModes, copy])
    setSelectedId(id)
  }

  function deleteMode() {
    persistCustom(customModes.filter((m) => m.id !== selected.id))
    setSelectedId(BUILTIN_MODES[0].id)
  }

  // ── Check-level operations ──────────────────────────────────────────────────

  function setChecks(checks) {
    updateSelected({ ...selected, checks })
  }

  function toggleCheck(id) {
    setChecks(selected.checks.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)))
  }

  function updateField(id, field, value) {
    setChecks(selected.checks.map((c) => (c.id === id ? { ...c, [field]: value } : c)))
  }

  function removeCheck(id) {
    setChecks(selected.checks.filter((c) => c.id !== id))
  }

  function addFromTemplate(tpl) {
    setChecks([...selected.checks, { id: uid(), ...tpl, enabled: true }])
    setShowPicker(false)
  }

  function addBlank() {
    setChecks([
      ...selected.checks,
      { id: uid(), label: 'Custom Check', type: 'custom', instruction: '', enabled: true },
    ])
    setShowPicker(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">

        {/* Left sidebar — mode list */}
        <aside className="modal-sidebar">
          <div className="modal-sidebar-title">Modes</div>
          {allModes.map((m) => (
            <button
              key={m.id}
              className={`modal-mode-item ${m.id === selectedId ? 'active' : ''}`}
              onClick={() => { setSelectedId(m.id); setShowPicker(false) }}
            >
              <span>{m.name}</span>
              {m.builtin && <span className="mode-badge">default</span>}
            </button>
          ))}
          <button className="modal-add-mode" onClick={addMode}>+ New Mode</button>
        </aside>

        {/* Right panel — view / edit selected mode */}
        <div className="modal-body">
          <div className="modal-header">
            <div className="modal-title-row">
              {isBuiltin ? (
                <h2 className="modal-mode-name">{selected.name}</h2>
              ) : (
                <input
                  className="modal-mode-name-input"
                  value={selected.name}
                  onChange={(e) => updateSelected({ ...selected, name: e.target.value })}
                />
              )}
              <div className="modal-actions">
                {isBuiltin && (
                  <button className="btn-sm btn-outline" onClick={duplicateMode}>
                    Duplicate & Edit
                  </button>
                )}
                {!isBuiltin && (
                  <button className="btn-sm btn-danger" onClick={deleteMode}>
                    Delete
                  </button>
                )}
                <button
                  className="btn-sm btn-primary"
                  onClick={() => { onSelectMode(selected.id); onClose() }}
                >
                  Use this mode
                </button>
                <button className="modal-close-btn" onClick={onClose}>×</button>
              </div>
            </div>

            {isBuiltin && (
              <p className="builtin-notice">
                Default modes are read-only. Click <strong>Duplicate &amp; Edit</strong> to create an editable copy.
              </p>
            )}
          </div>

          {/* Check list */}
          <div className="checks-list">
            {selected.checks.map((check) => (
              <div key={check.id} className={`check-item ${!check.enabled ? 'check-disabled' : ''}`}>
                <div className="check-header">
                  <label className="check-toggle-label">
                    <input
                      type="checkbox"
                      checked={check.enabled}
                      disabled={isBuiltin}
                      onChange={() => toggleCheck(check.id)}
                    />
                    {isBuiltin ? (
                      <span className="check-label-text">{check.label}</span>
                    ) : (
                      <input
                        className="check-label-input"
                        value={check.label}
                        onChange={(e) => updateField(check.id, 'label', e.target.value)}
                        placeholder="Check name"
                      />
                    )}
                  </label>
                  {!isBuiltin && (
                    <button className="check-remove" onClick={() => removeCheck(check.id)} title="Remove check">×</button>
                  )}
                </div>
                <textarea
                  className="check-instruction"
                  value={check.instruction}
                  readOnly={isBuiltin}
                  rows={2}
                  placeholder="Describe what to look for. This text goes directly to the AI, so be as specific as you want."
                  onChange={(e) => updateField(check.id, 'instruction', e.target.value)}
                />
              </div>
            ))}
          </div>

          {/* Add check */}
          {!isBuiltin && (
            <div className="add-check-area">
              {showPicker ? (
                <div className="check-picker">
                  <div className="picker-label">Add from template:</div>
                  <div className="picker-chips">
                    {CHECK_TEMPLATES.map((t) => (
                      <button key={t.templateId} className="picker-chip" onClick={() => addFromTemplate(t)}>
                        {t.label}
                      </button>
                    ))}
                    <button className="picker-chip picker-chip-blank" onClick={addBlank}>
                      + Blank
                    </button>
                  </div>
                  <button className="picker-cancel" onClick={() => setShowPicker(false)}>Cancel</button>
                </div>
              ) : (
                <button className="btn-add-check" onClick={() => setShowPicker(true)}>
                  + Add Check
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
