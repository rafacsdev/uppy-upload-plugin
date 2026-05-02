/**
 * Uppy Upload - Alpine.js component for Filament
 * Plugin: spykapps/filament-uppy-upload
 *
 * Uppy instance stored in WeakMap to avoid Alpine Proxy issues.
 * Supports multilingual UI via Uppy locale packs loaded from CDN.
 */
(function () {
    var uppyInstances = new WeakMap();
    var uppyModulePromise = null;
    var uppyLocaleCache = {};
    var RECORDING_WARNING_LIMIT_SECONDS = 120;

    var UPPY_LOCALE_MAP = {
        'en': null, 'ar': 'ar_SA', 'de': 'de_DE', 'es': 'es_ES',
        'fr': 'fr_FR', 'hi': 'hi_IN', 'nl': 'nl_NL', 'pt': 'pt_BR',
        'pt_BR': 'pt_BR', 'tr': 'tr_TR', 'ur': 'ur_PK', 'zh': 'zh_CN',
        'zh_CN': 'zh_CN', 'zh_TW': 'zh_TW', 'ja': 'ja_JP', 'ko': 'ko_KR',
        'it': 'it_IT', 'pl': 'pl_PL', 'ru': 'ru_RU', 'sv': 'sv_SE',
        'da': 'da_DK', 'fi': 'fi_FI', 'nb': 'nb_NO', 'cs': 'cs_CZ',
        'el': 'el_GR', 'he': 'he_IL', 'hu': 'hu_HU', 'id': 'id_ID',
        'ro': 'ro_RO', 'sk': 'sk_SK', 'th': 'th_TH', 'uk': 'uk_UA',
        'vi': 'vi_VN',
    };

    function loadUppyModule(version) {
        if (!uppyModulePromise) {
            uppyModulePromise = import('https://releases.transloadit.com/uppy/v' + version + '/uppy.min.mjs');
        }
        return uppyModulePromise;
    }

    function loadCss(version) {
        var url = 'https://releases.transloadit.com/uppy/v' + version + '/uppy.min.css';
        if (document.querySelector('link[href="' + url + '"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
    }

    async function loadUppyLocale(version, locale) {
        if (!locale || locale === 'en') return null;
        var uppyLocale = UPPY_LOCALE_MAP[locale] || UPPY_LOCALE_MAP[locale.split('_')[0]] || UPPY_LOCALE_MAP[locale.split('-')[0]];
        if (!uppyLocale) return null;
        if (uppyLocaleCache[uppyLocale]) return uppyLocaleCache[uppyLocale];
        try {
            // Tenta carregar do path local primeiro (/public/js/uppy-locales/)
            var localUrl = '/js/uppy-locales/' + uppyLocale + '.min.js';
            var resp = await fetch(localUrl);
            if (!resp.ok) {
                // Se local falhar, tenta do CDN remoto
                var cdnUrl = 'https://releases.transloadit.com/uppy/locales/v3.3.1/' + uppyLocale + '.min.js';
                resp = await fetch(cdnUrl);
            }
            if (!resp.ok) return null;
            var text = await resp.text();
            var fn = new Function(text + '; return globalThis.Uppy && globalThis.Uppy.locales && globalThis.Uppy.locales.' + uppyLocale + ';');
            var loc = fn();
            if (loc) { uppyLocaleCache[uppyLocale] = loc; return loc; }
        } catch (e) { console.warn('[UppyUpload] Failed to load locale ' + uppyLocale + ':', e); }
        return null;
    }

    function fmtBytes(b) {
        if (!b) return '0 B';
        var k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(b) / Math.log(k));
        return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    }

    function guessMime(name) {
        var ext = (name.split('.').pop() || '').toLowerCase();
        return ({
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
            gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
            pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
            mp3: 'audio/mpeg', wav: 'audio/wav', zip: 'application/zip',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xls: 'application/vnd.ms-excel',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            xml: 'application/xml',
        })[ext] || 'application/octet-stream';
    }

    function getCsrf() {
        var el = document.querySelector('meta[name="csrf-token"]');
        return el ? el.content : '';
    }

    function compactObject(obj) {
        return Object.fromEntries(Object.entries(obj).filter(function (entry) {
            return entry[1] !== undefined && entry[1] !== null && entry[1] !== '';
        }));
    }

    function translateUppyMessage(message) {
        if (!message) return message;

        if (typeof message === 'string') {
            if (/the request is not allowed/i.test(message)) {
                return 'A solicitação não foi permitida pelo navegador ou pelo dispositivo neste contexto.';
            }

            if (/permission denied|access denied|notallowederror/i.test(message)) {
                return 'Permissão negada. Autorize o acesso no navegador para continuar.';
            }

            return message;
        }

        if (typeof message === 'object') {
            var translated = Object.assign({}, message);

            if (translated.message) {
                translated.message = translateUppyMessage(translated.message);
            }

            if (translated.details) {
                translated.details = translateUppyMessage(translated.details);
            }

            return translated;
        }

        return message;
    }

    function createRecordingWarningController(uppy, limitSeconds) {
        var timer = null;

        function stop() {
            if (!timer) return;
            clearTimeout(timer);
            timer = null;
        }

        function start() {
            stop();
            timer = setTimeout(function () {
                uppy.info(
                    'A gravação está chegando no limite. Finalize agora para evitar perder o envio.',
                    'warning',
                    10000
                );
            }, limitSeconds * 1000);
        }

        function bindPlugin(plugin) {
            if (!plugin) return;

            if (typeof plugin.startRecording === 'function') {
                var originalStartRecording = plugin.startRecording.bind(plugin);
                plugin.startRecording = function () {
                    start();
                    return originalStartRecording.apply(plugin, arguments);
                };
            }

            if (typeof plugin.stopRecording === 'function') {
                var originalStopRecording = plugin.stopRecording.bind(plugin);
                plugin.stopRecording = function () {
                    stop();
                    return originalStopRecording.apply(plugin, arguments);
                };
            }
        }

        return {
            bindPlugin: bindPlugin,
            start: start,
            stop: stop,
        };
    }

    async function postWithRetry(url, formData, retries) {
        retries = retries || 3;
        var csrf = getCsrf();
        var lastErr;
        for (var a = 0; a < retries; a++) {
            try {
                var r = await fetch(url, {
                    method: 'POST',
                    headers: { 'X-CSRF-TOKEN': csrf, 'Accept': 'application/json' },
                    body: formData,
                });
                if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()));
                return await r.json();
            } catch (e) {
                lastErr = e;
                await new Promise(function (resolve) { setTimeout(resolve, [1000, 3000, 5000][a] || 5000); });
            }
        }
        throw lastErr;
    }

    function registerComponent(Alpine) {
        if (Alpine._uppyUploadRegistered) return;
        Alpine._uppyUploadRegistered = true;

        Alpine.data('uppyUpload', function (params) {
            var config = params.config;

            return {
                state: params.state,
                isLoading: true,

                _uppy() { return uppyInstances.get(this.$refs.uppyDashboard); },

                init() {
                    var self = this;
                    this._boot().catch(function (err) { console.error('[UppyUpload] Boot failed:', err); self.isLoading = false; });
                },

                async _boot() {
                    var version = config.uppyVersion || '5.2.1';
                    loadCss(version);
                    await this.$nextTick();
                    await this._initUppy();
                },

                async _initUppy() {
                    var el = this.$refs.uppyDashboard;
                    if (!el) { this.isLoading = false; return; }

                    var old = uppyInstances.get(el);
                    if (old) { try { old.cancelAll(); old.close(); } catch (e) {} uppyInstances.delete(el); }

                    var version = config.uppyVersion || '5.2.1';
                    var mod = await loadUppyModule(version);
                    var localeObj = await loadUppyLocale(version, config.locale);

                    var restrictions = {};
                    if (config.maxFileSize > 0) restrictions.maxFileSize = config.maxFileSize;
                    if (config.minFiles > 0) restrictions.minNumberOfFiles = config.minFiles;
                    if (config.acceptedFileTypes && config.acceptedFileTypes.length > 0) restrictions.allowedFileTypes = config.acceptedFileTypes;
                    if (config.multiple === false) { restrictions.maxNumberOfFiles = 1; }
                    else if (config.maxFiles > 0) { restrictions.maxNumberOfFiles = config.maxFiles; }

                    var t = config.translations || {};
                    var uppyLocaleStrings = compactObject({
                        uploadComplete: t.upload_complete,
                    });
                    var uppyOpts = { id: 'uppy-' + config.statePath.replace(/\./g, '-') + '-' + Date.now(), restrictions: restrictions, autoProceed: true };
                    if (localeObj) uppyOpts.locale = localeObj;
                    if (Object.keys(uppyLocaleStrings).length > 0) {
                        uppyOpts.locale = Object.assign({}, uppyOpts.locale || {}, {
                            strings: Object.assign({}, (uppyOpts.locale && uppyOpts.locale.strings) || {}, uppyLocaleStrings),
                        });
                    }

                    var uppy = new mod.Uppy(uppyOpts);
                    uppyInstances.set(el, uppy);
                    var recordingWarning = createRecordingWarningController(uppy, RECORDING_WARNING_LIMIT_SECONDS);
                    var originalInfo = uppy.info.bind(uppy);
                    uppy.info = function (message, type, duration) {
                        return originalInfo(translateUppyMessage(message), type, duration);
                    };

                    var detectedTheme = config.theme || 'auto';
                    if (detectedTheme === 'auto') detectedTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
                    var defaultNote = null;
                    if (config.maxFileSize > 0) {
                        defaultNote = (t.max_file_size || 'Tamanho máximo do arquivo') + ': ' + fmtBytes(config.maxFileSize);
                    }
                    var browseFilesLabel = 'carregar arquivo';
                    var dropFilesLabel = t.drop_files || 'Arraste os arquivos para ca';
                    var importFromLabel = t.or_import_from || 'ou importar de';
                    var dashboardLocaleStrings = compactObject({
                        browseFiles: browseFilesLabel,
                        dropPasteFiles: dropFilesLabel + ' ou %{browseFiles}',
                        dropPasteImportFiles: dropFilesLabel + ', %{browseFiles}, ' + importFromLabel,
                        importFiles: t.import_files,
                        importFrom: '%{name}',
                        myDevice: t.my_device,
                        uploadComplete: t.upload_complete,
                        xFilesSelected: {
                            0: t.file_selected,
                            1: t.files_selected,
                        },
                    });
                    var dashboardLocale = Object.keys(dashboardLocaleStrings).length > 0 ? { strings: dashboardLocaleStrings } : null;

                    uppy.use(mod.Dashboard, {
                        target: el, inline: config.inline !== false, width: '100%', height: config.height || 350,
                        showProgressDetails: true, showRemoveButtonAfterComplete: true,
                        proudlyDisplayPoweredByUppy: false, theme: detectedTheme,
                        singleFileFullScreen: config.multiple === false,
                        autoOpen: config.autoOpenFileEditor ? 'imageEditor' : null,
                        hideUploadButton: false, doneButtonHandler: null,
                        note: config.note || defaultNote,
                        locale: dashboardLocale,
                    });

                    if (config.webcam !== false && mod.Webcam) uppy.use(mod.Webcam, {
                        target: mod.Dashboard,
                        showVideoSourceDropdown: true,
                        showRecordingLength: true,
                        mirror: true,
                        modes: ['video-audio', 'video-only', 'audio-only', 'picture'],
                        locale: {
                            strings: {
                                takePicture: 'Tirar foto',
                                startRecording: 'Iniciar gravação',
                                allowAccessTitle: 'Permita acesso a sua camera',
                                allowAccessDescription: 'Para tirar fotos ou gravar video, permita o acesso a camera neste site.',
                                noCameraTitle: 'Camera indisponivel',
                                noCameraDescription: 'Para tirar fotos ou gravar video, conecte uma camera ao dispositivo.',
                                discardRecordedFile: 'Descartar arquivo',
                            },
                        },
                    });
                    if (config.screenCapture !== false && mod.ScreenCapture) uppy.use(mod.ScreenCapture, {
                        target: mod.Dashboard,
                        title: 'Gravar Tela',
                        locale: {
                            strings: {
                                pluginNameScreenCapture: 'Gravar Tela',
                                startCapturing: 'Gravar Tela',
                                stopCapturing: 'Parar gravação',
                                takeScreenshot: 'Tirar print',
                                submitRecordedFile: 'Salvando gravação de tela',
                                discardRecordedFile: 'Descartar arquivo',
                                cancel: 'Cancelar',
                                recording: 'Gravando',
                            },
                        },
                    });
                    if (config.audio !== false && mod.Audio) uppy.use(mod.Audio, {
                        target: mod.Dashboard,
                        showRecordingLength: true,
                        locale: {
                            strings: {
                                startAudioRecording: 'Iniciar gravação de áudio',
                                allowAudioAccessTitle: 'Permita acesso ao seu microfone',
                                allowAudioAccessDescription: 'Para gravar áudio, permita o acesso ao microfone neste site.',
                                noAudioTitle: 'Microfone indisponivel',
                                noAudioDescription: 'Para gravar audio, conecte um microfone ou outra entrada de audio.',
                                discardRecordedFile: 'Descartar arquivo',
                            },
                        },
                    });
                    if (config.imageEditor !== false && mod.ImageEditor) uppy.use(mod.ImageEditor, { target: mod.Dashboard, quality: 0.8 });
                    if (mod.Compressor) uppy.use(mod.Compressor, { quality: 0.8, limit: 10 });
                    if (config.dragDrop !== false && mod.DropTarget) { try { uppy.use(mod.DropTarget, { target: document.body }); } catch (e) {} }

                    if (config.companionUrl && mod.RemoteSources) {
                        try {
                            var rsOpts = { companionUrl: config.companionUrl };
                            if (config.remoteSources && config.remoteSources.length > 0) rsOpts.sources = config.remoteSources;
                            uppy.use(mod.RemoteSources, rsOpts);
                        } catch (e) { console.warn('[UppyUpload] RemoteSources failed:', e); }
                    }

                    recordingWarning.bindPlugin(uppy.getPlugin('Webcam'));
                    recordingWarning.bindPlugin(uppy.getPlugin('Audio'));
                    recordingWarning.bindPlugin(uppy.getPlugin('ScreenCapture'));

                    var self = this;
                    uppy.addUploader(function (fileIDs) { return self._handleUpload(fileIDs); });
                    uppy.on('file-removed', function (file, reason) {
                        if (reason === 'removed-by-user' && file.response && file.response.body && file.response.body.path) {
                            self._rmState(file.response.body.path);
                            self._rmServer(file.response.body.path);
                        }
                    });
                    uppy.on('cancel-all', function () { recordingWarning.stop(); });
                    uppy.on('complete', function () { recordingWarning.stop(); });
                    uppy.on('error', function () { recordingWarning.stop(); });

                    if (Array.isArray(this.state) && this.state.length > 0) this._syncExisting(uppy, this.state);
                    this.isLoading = false;
                },

                async _handleUpload(fileIDs) {
                    var uppy = this._uppy(); if (!uppy) return;
                    var filesToUpload = [];
                    for (var idx = 0; idx < fileIDs.length; idx++) {
                        var file = uppy.getFile(fileIDs[idx]);
                        if (file && !(file.progress && file.progress.uploadComplete)) filesToUpload.push(file);
                    }
                    if (filesToUpload.length === 0) return;
                    uppy.emit('upload-start', filesToUpload);
                    for (var i = 0; i < filesToUpload.length; i++) {
                        try { await this._uploadFile(uppy, filesToUpload[i], filesToUpload[i].id); }
                        catch (err) { console.error('[UppyUpload] Upload error:', err); uppy.emit('upload-error', filesToUpload[i], err); }
                    }
                },

                async _uploadFile(uppy, file, fid) {
                    var chunkSz = config.chunkSize || 5242880;
                    var blob = file.data, total = blob.size, chunks = Math.ceil(total / chunkSz);

                    if (chunks <= 1) {
                        var fd = new FormData();
                        fd.append('file', blob, file.name); fd.append('filename', file.name);
                        fd.append('disk', config.disk || 'public'); fd.append('directory', config.directory || 'uploads');
                        var ep = (config.uploadEndpoint || '/uppy/upload').replace(/\/upload$/, '/upload-single');
                        var res = await postWithRetry(ep, fd);
                        this._markComplete(uppy, file, fid, total, res); this._addState(res.path); return;
                    }

                    var uid = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
                    for (var i = 0; i < chunks; i++) {
                        var start = i * chunkSz, end = Math.min(start + chunkSz, total);
                        var fd = new FormData();
                        fd.append('file', blob.slice(start, end), file.name);
                        fd.append('chunk_index', i); fd.append('total_chunks', chunks); fd.append('upload_id', uid);
                        fd.append('filename', file.name); fd.append('disk', config.disk || 'public'); fd.append('directory', config.directory || 'uploads');
                        var res = await postWithRetry(config.uploadEndpoint || '/uppy/upload', fd);
                        uppy.emit('upload-progress', file, { uploader: this, bytesUploaded: end, bytesTotal: total });
                        if (res.completed) { this._markComplete(uppy, file, fid, total, res); this._addState(res); }
                    }
                },

                _markComplete(uppy, file, fid, size, res) {
                    uppy.setFileState(fid, { progress: { uploadComplete: true, uploadStarted: Date.now(), bytesUploaded: size, bytesTotal: size, percentage: 100 }, response: { status: 200, body: res } });
                    uppy.emit('upload-success', file, { status: 200, body: res });
                },

                _normalizeStateItem(item) {
                    if (!item) return null;
                    if (typeof item === 'string') return { path: item };
                    var path = item.path || null;
                    if (!path) return null;
                    return {
                        path: path,
                        size: item.size || null,
                        name: item.original_filename || item.name || item.filename || null,
                        mime_type: item.mime_type || null,
                    };
                },

                _addState(item) {
                    var normalized = this._normalizeStateItem(item);
                    if (!normalized || !normalized.path) return;
                    if (!Array.isArray(this.state)) this.state = [];
                    var exists = this.state.some(function (existing) {
                        if (typeof existing === 'string') return existing === normalized.path;
                        return existing && existing.path === normalized.path;
                    });
                    if (!exists) this.state = this.state.concat([normalized]);
                    if (this.$wire && typeof this.$wire.$set === 'function' && config.statePath) {
                        this.$wire.$set(config.statePath, this.state, true);
                    }
                    window.dispatchEvent(new CustomEvent('uppy-upload-complete', {
                        detail: {
                            statePath: config.statePath || null,
                            path: normalized.path || null,
                            item: normalized,
                        },
                    }));
                },

                _rmState(path) {
                    if (Array.isArray(this.state)) this.state = this.state.filter(function (x) {
                        if (typeof x === 'string') return x !== path;
                        return !x || x.path !== path;
                    });
                    if (this.$wire && typeof this.$wire.$set === 'function' && config.statePath) {
                        this.$wire.$set(config.statePath, this.state, true);
                    }
                },

                async _rmServer(path) {
                    if (!config.deleteEndpoint) return;
                    try { await fetch(config.deleteEndpoint, { method: 'POST', headers: { 'X-CSRF-TOKEN': getCsrf(), 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path, disk: config.disk || 'public' }) }); } catch (e) {}
                },

                _syncExisting(uppy, paths) {
                    paths.forEach(function (item) {
                        var p = typeof item === 'string' ? item : (item && item.path ? item.path : null);
                        if (!p) return;
                        var nm = (item && (item.name || item.original_filename || item.filename)) || p.split('/').pop();
                        try {
                            var id = uppy.addFile({ name: nm, type: guessMime(nm), data: new Blob(['']), source: 'existing', isRemote: false });
                            uppy.setFileState(id, { progress: { uploadComplete: true, uploadStarted: Date.now(), bytesUploaded: 1, bytesTotal: 1, percentage: 100 }, response: { status: 200, body: { path: p, filename: nm, original_filename: nm } } });
                        } catch (e) {}
                    });
                },

                destroy() {
                    var el = this.$refs.uppyDashboard;
                    if (el) { var uppy = uppyInstances.get(el); if (uppy) { try { uppy.cancelAll(); uppy.close(); } catch (e) {} uppyInstances.delete(el); } }
                },
            };
        });
    }

    if (window.Alpine) registerComponent(window.Alpine);
    document.addEventListener('alpine:init', function () { if (window.Alpine) registerComponent(window.Alpine); });
})();
