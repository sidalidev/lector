import AppMark from './AppMark';
import { useState, useEffect } from 'react';
import { Cloud, CloudCog, FolderOpen, Clock, BookOpen } from 'lucide-react';
import fileSystem, { getPlatformType } from '../services/fileSystem';
import { t } from '../services/i18n'
import formatRelativeTime from '../utils/formatRelativeTime'
import './SourcePicker.css';

function SourcePicker({ onSelectICloud, onSelectFolder, onSelectFile, onSelectLectorCloud, onSelectDemo, recentFiles, onOpenRecent }) {
  const isCapacitor = fileSystem.isCapacitor();
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    getPlatformType().then(setPlatform);
  }, []);

  const isAndroid = platform === 'android';
  const isIOS = platform === 'ios';
  // Tant que la platform n'est pas détectée sur Capacitor, ne rien afficher
  if (isCapacitor && !platform) {
    return (
      <div className="source-picker">
        <div className="source-picker-inner">
          <div className="source-picker-logo">
            <AppMark size={64} />
          </div>
          <h2 className="source-picker-title">Lector</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="source-picker">
      <div className="source-picker-inner">
        <div className="source-picker-logo">
          <AppMark size={64} />
        </div>
        <h2 className="source-picker-title">Lector</h2>
        <p className="source-picker-subtitle">{t('source.subtitle')}</p>

        <div className="source-picker-cards">
          {/* Ordinateur et web : le vault synchronisé par la chaîne */}
          {!isCapacitor && onSelectLectorCloud && (
            <button className="source-card source-card-featured" onClick={onSelectLectorCloud}>
              <span className="source-card-icon"><CloudCog size={28} /></span>
              <span className="source-card-title">{t('source.vault')}</span>
              <span className="source-card-desc">{t('source.vaultDesc')}</span>
            </button>
          )}

          {/* Mobile (iOS) : iCloud */}
          {isIOS && (
            <button className="source-card" onClick={onSelectICloud}>
              <span className="source-card-icon"><Cloud size={28} /></span>
              <span className="source-card-title">{t('source.icloud')}</span>
              <span className="source-card-desc">{t('source.icloudDesc')}</span>
            </button>
          )}

          {/* Mobile (Android) : dossier local via SAF.
              L'ancienne carte « Google Drive » mentait : ACTION_OPEN_DOCUMENT_TREE
              ne propose pas Drive: un reviewer y voyait une fonction cassée. */}
          {isAndroid && (
            <button className="source-card" onClick={onSelectFolder}>
              <span className="source-card-icon"><FolderOpen size={28} /></span>
              <span className="source-card-title">{t('source.folder')}</span>
              <span className="source-card-desc">{t('source.folderDesc')}</span>
            </button>
          )}

          {/* Toutes plateformes : démo embarquée, zéro configuration.
              Répond directement au rejet « broken functionality » de mars :
              le reviewer voit le produit sans compte ni service externe. */}
          {onSelectDemo && (
            <button className="source-card source-card-demo" onClick={onSelectDemo}>
              <span className="source-card-icon"><BookOpen size={28} /></span>
              <span className="source-card-title">{t('source.demo')}</span>
              <span className="source-card-desc">{t('source.demoDesc')}</span>
            </button>
          )}
        </div>

        {recentFiles && recentFiles.length > 0 && (
          <div className="source-picker-recents">
            <h3 className="source-picker-recents-title">
              <Clock size={13} />
              {t('source.recentFiles')}
            </h3>
            <div className="source-picker-recents-list">
              {recentFiles.slice(0, 8).map(f => (
                <button
                  key={f.filePath}
                  className="source-picker-recent-item"
                  onClick={() => onOpenRecent(f.filePath)}
                >
                  <span className="source-picker-recent-name">{f.fileName}</span>
                  <span className="source-picker-recent-meta">
                    <span className="source-picker-recent-count">{f.openCount}x</span>
                    <span className="source-picker-recent-time">{formatRelativeTime(f.lastOpenedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isCapacitor && <p className="source-picker-hint">{t('source.hint')}</p>}
      </div>
    </div>
  );
}

export default SourcePicker;
