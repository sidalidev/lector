import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Trash2, X, Loader, Search, FilePlus, KeyRound, Bug } from 'lucide-react';
import { chatWithContext, checkClaudeStatus, parseSearchAction, generateDocumentContent, getAIMode, setWorkspaceDir, setModel, setEffort, MODELS, EFFORTS, getModelConfig, listerModeles, onLog, getLogs } from '../services/claude'
import { searchAllDocuments, buildExtraContext, listWorkspaceFiles } from '../services/docSearch'
import { hashString } from '../services/constants'
import fileSystem from '../services/fileSystem'
import storage from '../services/storage'
import { onKeysChanged } from '../services/apiKeys'
import { messageCle, besoinDeCle } from '../utils/messagesErreur'
import { cheminDans } from '../utils/chemins'
import './ChatPanel.css';
import { t } from '../services/i18n'

// Regex to match [ligne X] or [lignes X-Y]
const LINE_REF_REGEX = /\[lignes?\s+(\d+)(?:\s*[-\u2013]\s*(\d+))?\]/gi;

// Process React children to replace [ligne X] text with clickable buttons
function processLineRefs(children, onNavigateToLine) {
  if (!onNavigateToLine) return children;
  return Array.isArray(children)
    ? children.map((child, i) => processLineRefNode(child, onNavigateToLine, i))
    : processLineRefNode(children, onNavigateToLine, 0);
}

function processLineRefNode(node, onNavigateToLine, key) {
  if (typeof node !== 'string') return node;
  const parts = [];
  let lastIndex = 0;
  let match;
  const regex = new RegExp(LINE_REF_REGEX.source, 'gi');
  while ((match = regex.exec(node)) !== null) {
    if (match.index > lastIndex) {
      parts.push(node.slice(lastIndex, match.index));
    }
    const lineStart = parseInt(match[1], 10);
    const lineEnd = match[2] ? parseInt(match[2], 10) : lineStart;
    const label = match[0];
    parts.push(
      <button
        key={`lr-${key}-${match.index}`}
        className="chat-line-ref"
        onClick={() => onNavigateToLine(lineStart, lineEnd)}
        title={label}
      >
        {label}
      </button>
    );
    lastIndex = regex.lastIndex;
  }
  if (parts.length === 0) return node;
  if (lastIndex < node.length) parts.push(node.slice(lastIndex));
  return parts;
}


// Regex pour détecter une demande de création de doc
const CREATE_REGEX = /\b(create|write|make|generate|cr[ée]{1,2}[es]?|[ée]cris|fais|r[ée]dige|g[ée]n[èe]re)\b.*\b(doc|fiche|sheet|note|document|about|sur|de)\b/i

// Regex pour détecter une intention d'apprentissage → génère un doc complet
const LEARN_REGEX = /\b(apprends|explique|explain|learn|teach|comprendre|understand)\b.{2,}|^c'?est quoi\b|^what is\b/i

export default function ChatPanel({ documentContent, filePath, onClose, onNavigateToLine, rootDirPath, onOpenFile, onShowApiKeys }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);
  const [aiMode, setAiMode] = useState(null); // { mode, model, label }
  const [modeles, setModeles] = useState(MODELS);
  const [fileList, setFileList] = useState(null); // liste des fichiers du workspace
  const [loadingStep, setLoadingStep] = useState(null) // étape verbose pendant le loading
  const [searchPhase, setSearchPhase] = useState(null); // null | 'searching' | 'creating'
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState(getLogs);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const logsEndRef = useRef(null);

  // Clé de stockage globale basée sur le workspace (pas le fichier)
  const storageKey = rootDirPath ? `lector-chat-global-${hashString(rootDirPath)}` : 'lector-chat-global'

  // Mode : contextuel si un doc est ouvert, global sinon
  const isGlobal = !documentContent

  // Charger les messages depuis localStorage
  useEffect(() => {
    const saved = storage.get(storageKey, null)
    if (Array.isArray(saved) && saved.length > 0) {
      setMessages(saved)
    } else {
      setMessages([])
    }
  }, [storageKey])

  // Sauvegarder les messages dans localStorage
  useEffect(() => {
    if (messages.length === 0) return
    storage.set(storageKey, messages)
  }, [messages, storageKey])

  // Écouter les logs IA
  useEffect(() => {
    return onLog((entry) => {
      setLogs(prev => [...prev.slice(-49), entry])
      setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    })
  }, [])

  // Disponibilité (outil local ou clé API), mode, modèles ; revérifiés quand une clé change
  useEffect(() => {
    const verifier = () => {
      checkClaudeStatus().then(s => setAvailable(s.available))
      getAIMode().then(setAiMode)
      listerModeles().then(setModeles)
    }
    verifier()
    return onKeysChanged(verifier)
  }, []);

  useEffect(() => {
    if (rootDirPath) {
      listWorkspaceFiles(rootDirPath).then(setFileList)
      setWorkspaceDir(rootDirPath)
    }
  }, [rootDirPath]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Créer une fiche à partir d'un sujet
  const handleCreateDoc = useCallback(async (topic) => {
    if (!rootDirPath) return
    setSearchPhase('creating')

    // Étapes de progression pour que l'user voie ce qui se passe
    const steps = [
      { delay: 0, text: t('chat.create.analyzing') },
      { delay: 5000, text: t('chat.create.structuring') },
      { delay: 15000, text: t('chat.create.writing') },
      { delay: 40000, text: t('chat.create.cards') },
      { delay: 80000, text: t('chat.create.map') },
      { delay: 150000, text: t('chat.create.long') },
    ]
    const stepTimers = []
    const updateStep = (text) => {
      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'system')
        return [...filtered, { role: 'system', text, time: Date.now() }]
      })
    }
    for (const step of steps) {
      stepTimers.push(setTimeout(() => updateStep(step.text), step.delay))
    }

    try {
      const result = await generateDocumentContent(topic)
      stepTimers.forEach(clearTimeout)
      if (!result.success) {
        const erreur = new Error(result.code ? messageCle(result.code) : result.error)
        erreur.code = result.code
        throw erreur
      }

      // Créer le fichier
      const safeName = topic
        .replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .substring(0, 50)
      const fileName = `${safeName}.md`
      const newFilePath = cheminDans(rootDirPath, fileName)

      await fileSystem.writeFile(newFilePath, result.result)

      // Remplacer le message système par le succès
      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'system')
        return [...filtered, {
          role: 'assistant',
          text: t('chat.docCreated'),
          time: Date.now(),
          createdDoc: { fileName, filePath: newFilePath },
        }]
      })
    } catch (err) {
      stepTimers.forEach(clearTimeout)
      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'system')
        return [...filtered, {
          role: 'assistant',
          text: t('chat.errorPrefix', { error: err.message }),
          time: Date.now(),
          error: true,
          code: err.code,
        }]
      })
    } finally {
      setSearchPhase(null)
    }
  }, [rootDirPath])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', text, time: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setLoadingStep(t('chat.thinking'))

    // Timer pour mettre à jour le step si ça prend du temps
    const stepTimers = [
      setTimeout(() => setLoadingStep(t('chat.step.reading')), 3000),
      setTimeout(() => setLoadingStep(t('chat.step.searching')), 8000),
      setTimeout(() => setLoadingStep(t('chat.step.writing')), 15000),
      setTimeout(() => setLoadingStep(t('chat.step.still')), 40000),
    ]
    const clearStepTimers = () => { stepTimers.forEach(clearTimeout); setLoadingStep(null) }

    try {
      const history = [...messages, userMsg]

      // Détection de demande de création directe (mode global ou contextuel)
      if (rootDirPath && CREATE_REGEX.test(text)) {
        // Extraire le sujet de la demande
        const topic = text
          .replace(/\b(create|write|make|generate|cr[ée]{1,2}[es]?|[ée]cris|fais|r[ée]dige|g[ée]n[èe]re)\b/gi, '')
          .replace(/\b(a|an|the|un|une|des|le|la|les|me|moi)\b/gi, '')
          .replace(/\b(doc|fiche|sheet|note|document|about|sur|de)\b/gi, '')
          .trim() || text
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: t('chat.notFoundPropose'),
          time: Date.now(),
          action: 'create_doc',
          topic,
        }])
        setLoading(false)
        return
      }

      // Mode global + intention d'apprentissage → créer un doc complet directement
      if (isGlobal && rootDirPath && LEARN_REGEX.test(text)) {
        const topic = text
          .replace(/\b(apprends|explique|explain|learn|teach|comprendre|understand)\b/gi, '')
          .replace(/\b(moi|me|à|a|the|un|une|des|le|la|les|comment|how|what)\b/gi, '')
          .replace(/^(c'?est quoi|what is)\s*/i, '')
          .trim() || text
        await handleCreateDoc(topic)
        setLoading(false)
        return
      }

      // Ajouter la liste des fichiers du workspace (le CLI a accès en lecture au dossier)
      const docContentWithFileList = documentContent
        ? documentContent + (fileList?.length ? `\n\n[Fichiers disponibles dans la bibliothèque : ${fileList.join(', ')}. Tu peux les lire si nécessaire pour répondre.]` : '')
        : null

      const result = await chatWithContext(text, docContentWithFileList, history)

      if (!result.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: t('chat.errorPrefix', { error: result.code ? messageCle(result.code) : (result.error || t('chat.unavailable')) }),
          time: Date.now(),
          error: true,
          code: result.code,
        }])
        return
      }

      // Vérifier si l'AI demande une recherche cross-doc
      const searchKeywords = parseSearchAction(result.result)

      if (searchKeywords && rootDirPath) {
        // Phase recherche multi-doc
        setSearchPhase('searching')
        setMessages(prev => [...prev, {
          role: 'system',
          text: t('chat.searchingDocs'),
          time: Date.now(),
        }])

        const searchResults = await searchAllDocuments(rootDirPath, searchKeywords, {
          maxResults: 5,
          excludePath: filePath,
        })

        if (searchResults.results.length > 0) {
          // Trouvé dans d'autres docs → re-question avec contexte enrichi
          const extraContext = await buildExtraContext(searchResults.results)
          const enrichedResult = await chatWithContext(text, documentContent, history, extraContext)

          // Retirer le message système
          setMessages(prev => {
            const filtered = prev.filter(m => m.role !== 'system')
            if (enrichedResult.success) {
              return [...filtered, {
                role: 'assistant',
                text: enrichedResult.result,
                time: Date.now(),
                sources: searchResults.results.map(r => ({ fileName: r.fileName, filePath: r.filePath })),
              }]
            }
            return [...filtered, {
              role: 'assistant',
              text: t('chat.errorPrefix', { error: enrichedResult.code ? messageCle(enrichedResult.code) : (enrichedResult.error || t('chat.unavailable')) }),
              time: Date.now(),
              error: true,
              code: enrichedResult.code,
            }]
          })
        } else {
          // Rien trouvé nulle part → proposer de créer une fiche
          setMessages(prev => {
            const filtered = prev.filter(m => m.role !== 'system')
            return [...filtered, {
              role: 'assistant',
              text: t('chat.notFoundPropose'),
              time: Date.now(),
              action: 'create_doc',
              topic: text,
            }]
          })
        }
        setSearchPhase(null)
      } else {
        // Réponse normale
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: result.result,
          time: Date.now(),
        }])
      }
    } catch (err) {
      setMessages(prev => {
        const filtered = prev.filter(m => m.role !== 'system')
        return [...filtered, {
          role: 'assistant',
          text: t('chat.errorPrefix', { error: err.message }),
          time: Date.now(),
          error: true,
        }]
      })
      setSearchPhase(null)
    } finally {
      clearStepTimers()
      setLoading(false)
    }
  }, [input, loading, messages, documentContent, rootDirPath, filePath, fileList])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([])
    storage.remove(storageKey)
  }

  if (!available) {
    return (
      <div className="chat-panel">
        <div className="chat-header">
          <span className="chat-title">{t('chat.title')}</span>
          <button className="chat-close-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="chat-gate">
          <KeyRound size={32} className="chat-gate-icon" />
          <p className="chat-gate-text">{t('chat.needKey')}</p>
          {onShowApiKeys && (
            <button className="chat-gate-btn" onClick={onShowApiKeys}>
              {t('keys.open')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-left">
          <span className="chat-title">{t('chat.title')}</span>
          {aiMode?.label && (
            <span className={`chat-mode-badge chat-mode-${aiMode.mode}`}>
              {aiMode.mode === 'local' ? '⚡' : '☁️'}
            </span>
          )}
          <select
            className="chat-model-select"
            value={getModelConfig().model}
            onChange={(e) => { setModel(e.target.value); getAIMode().then(setAiMode) }}
          >
            {modeles.map(m => <option key={m.id} value={m.id}>{m.short}</option>)}
          </select>
          <select
            className="chat-effort-select"
            value={getModelConfig().effort}
            onChange={(e) => setEffort(e.target.value)}
          >
            {EFFORTS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div className="chat-header-actions">
          <button className={`chat-log-btn ${showLogs ? 'active' : ''}`} onClick={() => setShowLogs(p => !p)} title={t('chat.logs')}>
            <Bug size={13} />
          </button>
          {messages.length > 0 && (
            <button className="chat-clear-btn" onClick={handleClear} title={t('chat.clearConvo')}>
              <Trash2 size={13} />
            </button>
          )}
          <button className="chat-close-btn" onClick={onClose}><X size={14} /></button>
        </div>
      </div>

      {showLogs && (
        <div className="chat-logs">
          {logs.length === 0 && <span className="chat-log-empty">{t('chat.noLogs')}</span>}
          {logs.map((log, i) => (
            <div key={i} className={`chat-log-entry chat-log-${log.type}`}>
              <span className="chat-log-time">{new Date(log.time).toLocaleTimeString()}</span>
              {log.type === 'request' && (
                <span>→ {log.mode === 'local' ? '⚡' : '☁️'} <b>{log.model?.split('-').slice(1, 3).join(' ')}</b> · {log.effort || ''} · {log.promptLen} chars {log.endpoint ? `· ${log.endpoint}` : ''}</span>
              )}
              {log.type === 'response' && (
                <span>← {log.success ? '✅' : '❌'} {log.duration}ms · {log.resultLen} chars {log.error ? `· ${log.error}` : ''}</span>
              )}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">{isGlobal ? '💬' : '🎓'}</div>
            <div className="chat-empty-title">{isGlobal ? t('chat.globalTitle') : t('chat.tutor')}</div>
            <div className="chat-empty-hint">{isGlobal ? t('chat.globalHint') : t('chat.examples')}</div>
            <div className="chat-empty-examples">{isGlobal ? t('chat.globalExamples') : ''}</div>
          </div>
        )}
        {messages.map((msg, i) => {
          // Message système (spinner recherche / création)
          if (msg.role === 'system') {
            return (
              <div key={i} className="chat-bubble system">
                <div className="chat-system-msg">
                  <Loader size={14} className="chat-loading-spinner" />
                  <span>{msg.text}</span>
                </div>
              </div>
            )
          }

          return (
            <div key={i} className={`chat-bubble ${msg.role} ${msg.error ? 'error' : ''}`}>
              <div className="chat-bubble-content">
                {msg.role === 'assistant' ? (
                  <>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p>{processLineRefs(children, onNavigateToLine)}</p>,
                        li: ({ children }) => <li>{processLineRefs(children, onNavigateToLine)}</li>,
                      }}
                    >{msg.text}</ReactMarkdown>

                    {/* Liens vers les docs sources */}
                    {msg.sources?.length > 0 && (
                      <div className="chat-sources">
                        <Search size={12} />
                        {msg.sources.map((src, j) => (
                          <button
                            key={j}
                            className="chat-source-link"
                            onClick={() => onOpenFile?.(src.filePath)}
                          >
                            {src.fileName}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Bouton créer une fiche */}
                    {msg.action === 'create_doc' && rootDirPath && (
                      <button
                        className="chat-create-doc-btn"
                        onClick={() => handleCreateDoc(msg.topic)}
                        disabled={searchPhase === 'creating'}
                      >
                        <FilePlus size={14} />
                        {t('chat.createDoc')}
                      </button>
                    )}

                    {/* Clé absente ou refusée : l'écran des clés règle le problème */}
                    {msg.error && besoinDeCle(msg.code) && onShowApiKeys && (
                      <button className="chat-source-link" onClick={onShowApiKeys}>
                        <KeyRound size={12} /> {t('keys.open')}
                      </button>
                    )}

                    {/* Lien vers la fiche créée */}
                    {msg.createdDoc && (
                      <button
                        className="chat-source-link chat-open-created"
                        onClick={() => onOpenFile?.(msg.createdDoc.filePath)}
                      >
                        {t('chat.openCreatedDoc', { name: msg.createdDoc.fileName })}
                      </button>
                    )}
                  </>
                ) : (
                  <p>{msg.text}</p>
                )}
              </div>
            </div>
          )
        })}
        {loading && (
          <div className="chat-bubble assistant loading">
            <Loader size={14} className="chat-loading-spinner" />
            <span className="chat-loading-text">{loadingStep || t('chat.thinking')}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isGlobal ? t('chat.globalPlaceholder') : t('chat.placeholder')}
          rows={1}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || loading}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
