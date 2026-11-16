'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const dbName = 'reading-room-library';
  const starterCategories = ['History', 'Biography', 'Fiction', 'Philosophy', 'Religion', 'Science', 'Politics', 'Business', 'Technology', 'Other'];
  let db, books = [], view = 'overview', categoryFilter = '', editingId = null, currentCover = '', currentSource = '', searchResults = [], toastTimer, hasSearchOrigin = false;
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

  function showToast(message, duration = 3500) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), duration);
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('books')) req.result.createObjectStore('books', { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Another tab is blocking local storage.'));
    });
  }
  function getBooks() {
    return new Promise((resolve, reject) => {
      const req = db.transaction('books', 'readonly').objectStore('books').getAll();
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  function transactBooks(items, mode = 'put') {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite'); const store = tx.objectStore('books');
      for (const item of items) mode === 'delete' ? store.delete(item) : store.put(item);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Storage transaction was cancelled.'));
    });
  }
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isSafeCover = (url) => !url || /^https:\/\//i.test(url) || /^data:image\/(?:jpeg|png|webp|avif);base64,/i.test(url);
  const isSafeSource = (url) => /^https:\/\/openlibrary\.org\//i.test(url || '');
  const titleSort = (a, b) => collator.compare(a.title, b.title) || collator.compare(a.author, b.author);
  function cleanTags(input) {
    const seen = new Set(); return (Array.isArray(input) ? input : String(input || '').split(',')).map(t => String(t).trim().replace(/\s+/g, ' ')).filter(t => {
      const key = t.toLocaleLowerCase(); if (!t || seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 12).map(t => t.slice(0, 60));
  }
  function categories() {
    const counts = new Map();
    for (const book of books) { const label = book.category || 'Other'; counts.set(label, (counts.get(label) || 0) + 1); }
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => collator.compare(a.name, b.name));
  }
  function makeCover(url, title, className = 'cover') {
    const wrapper = document.createElement('div'); wrapper.className = className;
    const fallback = document.createElement('div'); fallback.className = 'cover-placeholder';
    fallback.innerHTML = icon('book'); const text = document.createElement('span'); text.textContent = title || 'Your book'; fallback.append(text);
    wrapper.append(fallback);
    if (url && isSafeCover(url)) {
      const img = document.createElement('img'); img.alt = `Cover of ${title || 'book'}`; img.loading = 'lazy';
      img.addEventListener('load', () => { fallback.hidden = true; });
      img.addEventListener('error', () => { img.remove(); fallback.hidden = false; });
      wrapper.prepend(img); img.src = url;
    }
    return wrapper;
  }
  function renderCoverPreview() { $('#cover-preview').replaceChildren(...Array.from(makeCover(currentCover, $('#field-title').value || 'Book cover', 'cover-preview-inner').childNodes)); }
  function makeBookCard(book) {
    const card = document.createElement('article'); card.className = 'book-card';
    card.append(makeCover(book.cover, book.title));
    const title = document.createElement('div'); title.className = 'book-title'; title.textContent = book.title; card.append(title);
    const author = document.createElement('p'); author.className = 'book-author'; author.textContent = book.author || 'Author not added'; card.append(author);
    if (book.rating || book.tags?.length) {
      const meta = document.createElement('div'); meta.className = 'book-meta';
      if (book.rating) { const rating = document.createElement('span'); rating.className = 'rating-chip'; rating.textContent = `★ ${book.rating}/10`; meta.append(rating); }
      for (const tag of (book.tags || []).slice(0, 2)) { const chip = document.createElement('span'); chip.className = 'tag-chip'; chip.textContent = tag; meta.append(chip); }
      card.append(meta);
    }
    const actions = document.createElement('div'); actions.className = 'book-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${book.title}`); edit.addEventListener('click', () => editBook(book.id));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${book.title}`); remove.addEventListener('click', () => removeBook(book.id));
    actions.append(edit, remove); card.append(actions); return card;
  }
  function emptyCollection() {
    const node = document.createElement('div'); node.className = 'empty-library';
    node.innerHTML = `<div class="empty-illustration" aria-hidden="true"><span class="draw-book one"></span><span class="draw-book two"></span><span class="draw-book three"></span></div><h3 class="empty-title">Your next chapter starts here.</h3><p class="empty-copy">A little space for the books that shaped you. Add your first book to start your collection.</p><button class="button button-dark" type="button">${icon('plus')} Add your first book</button>`;
    node.querySelector('button').addEventListener('click', openAdd); return node;
  }
  function renderStats() {
    const cats = categories(), rated = books.filter(b => Number.isInteger(b.rating));
    $('#stat-books').textContent = String(books.length); $('#stat-genres').textContent = String(cats.length);
    $('#stat-rating').textContent = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : '—';
    const top = [...cats].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))[0];
    $('#stat-top').textContent = top?.name || '—'; $('#stat-top-desc').textContent = top ? `${top.count} ${top.count === 1 ? 'book' : 'books'} on this shelf` : 'Your most-read category';
    $('#nav-count').textContent = String(books.length);
    const sidebar = $('#sidebar-genres'); sidebar.replaceChildren();
    if (!cats.length) sidebar.innerHTML = '<p class="empty-nav">Your categories will appear here.</p>';
    for (const cat of cats) {
      const button = document.createElement('button'); button.className = 'genre-nav-item';
      const dot = document.createElement('span'); dot.className = 'genre-dot'; const name = document.createElement('span'); name.textContent = cat.name;
      const count = document.createElement('span'); count.className = 'genre-count'; count.textContent = cat.count;
      button.append(dot, name, count); button.addEventListener('click', () => { categoryFilter = cat.name; changeView('library'); }); sidebar.append(button);
    }
    const options = $('#category-filter'); options.replaceChildren(new Option('All categories', ''));
    for (const cat of cats) options.add(new Option(cat.name, cat.name));
    if (categoryFilter && !cats.some(c => c.name === categoryFilter)) categoryFilter = '';
    options.value = categoryFilter;
    const list = $('#category-options'); list.replaceChildren();
    for (const category of Array.from(new Set([...starterCategories, ...cats.map(c => c.name)])).sort(collator.compare)) { const option = document.createElement('option'); option.value = category; list.append(option); }
    const chart = $('#genre-chart'); chart.replaceChildren();
    if (!cats.length) { chart.innerHTML = '<div class="chart-empty"><div class="chart-rings" aria-hidden="true"><span></span><span></span><span></span></div>Your reading mix will come to life<br>as you add books.</div>'; return; }
    const ranked = [...cats].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
    const shown = ranked.slice(0, 5); if (ranked.length > 5) shown.push({name:'Other categories',count:ranked.slice(5).reduce((s,c)=>s+c.count,0)});
    for (const cat of shown) {
      const row = document.createElement('div'); row.className = 'chart-row';
      const label = document.createElement('div'); label.className = 'chart-label';
      const name = document.createElement('span'); name.textContent = cat.name; const count = document.createElement('span'); count.textContent = `${cat.count} · ${Math.round(cat.count / books.length * 100)}%`;
      label.append(name, count); const track = document.createElement('div'); track.className = 'chart-track';
      const fill = document.createElement('div'); fill.className = 'chart-fill'; fill.style.width = `${cat.count / books.length * 100}%`; track.append(fill); row.append(label, track); chart.append(row);
    }
  }
  function renderRecent() {
    const node = $('#recent-panel'); node.replaceChildren();
    if (!books.length) { node.append(emptyCollection()); return; }
    const grid = document.createElement('div'); grid.className = 'recent-books';
    [...books].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5).forEach(book => grid.append(makeBookCard(book))); node.append(grid);
  }
  function renderLibrary() {
    const query = $('#library-search').value.trim().toLocaleLowerCase();
    const filtered = books.filter(book => (!categoryFilter || book.category === categoryFilter) && (!query || [book.title, book.author, book.category, ...(book.tags || [])].some(s => (s || '').toLocaleLowerCase().includes(query))));
    $('#library-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'book' : 'books'}`;
    const node = $('#library-content'); node.replaceChildren();
    if (!books.length) { const panel = document.createElement('div'); panel.className = 'library-empty'; panel.append(emptyCollection()); node.append(panel); return; }
    if (!filtered.length) { node.innerHTML = '<div class="library-empty no-results"><strong>No books found.</strong><p>Try a different search or choose another category.</p></div>'; return; }
    const groups = new Map();
    filtered.sort(titleSort).forEach(book => { const category = book.category || 'Other'; if (!groups.has(category)) groups.set(category, []); groups.get(category).push(book); });
    for (const category of [...groups.keys()].sort(collator.compare)) {
      const section = document.createElement('section'); section.className = 'shelf-section';
      const heading = document.createElement('div'); heading.className = 'shelf-heading'; const title = document.createElement('h2'); title.textContent = category;
      const count = document.createElement('span'); count.textContent = groups.get(category).length; heading.append(title, count);
      const grid = document.createElement('div'); grid.className = 'books-grid'; groups.get(category).forEach(book => grid.append(makeBookCard(book)));
      section.append(heading, grid); node.append(section);
    }
  }
  function render() { renderStats(); renderRecent(); renderLibrary(); }
  function changeView(next) {
    view = next; $('#overview-view').classList.toggle('hidden', view !== 'overview'); $('#library-view').classList.toggle('hidden', view !== 'library');
    $$('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    $('#breadcrumb').textContent = view === 'overview' ? 'OVERVIEW' : 'MY LIBRARY';
    if (view === 'library') { $('#category-filter').value = categoryFilter; renderLibrary(); }
    window.scrollTo({top:0,behavior:'auto'});
  }
  function inferBook(doc) {
    const combined = [doc.title || '', ...(doc.subject || [])].join(' | ').toLowerCase();
    // These are intentionally simple suggestions; the owner always chooses the final shelf.
    const categoryRules = [
      ['Fiction', /\b(fiction|novels?|short stories|fantasy|science fiction)\b/],
      ['Biography', /\b(biograph|autobiograph|memoirs?)\w*/],
      ['History', /\b(history|historical|civilization|archaeolog|empire|world war|colonialism)\w*/],
      ['Philosophy', /\b(philosoph|ethics|metaphysics|epistemology)\w*/],
      ['Religion', /\b(religion|theology|islam|muslim|christianity|hinduism|buddhism|qur.?an)\w*/],
      ['Science', /\b(science|physics|biology|astronomy|chemistry|evolution)\w*/],
      ['Politics', /\b(politic|government|democracy|constitution|public policy)\w*/],
      ['Business', /\b(business|entrepreneur|economics|investing|finance|management)\w*/],
      ['Technology', /\b(computer|software|programming|technology|artificial intelligence)\w*/]
    ];
    const category = categoryRules.find(([, pattern]) => pattern.test(combined))?.[0] || 'Other';
    const tagRules = [
      ['Indian history', /\b(india|indian|south asia|hindustan)\w*/], ['Mughal history', /\b(mughal|mogul|aurangzeb|akbar)\w*/],
      ['Islamic history', /\b(islamic history|islamic civilization|muslim history|ottoman|caliphate)\w*/], ['Military history', /\b(military|warfare|battles?|armed forces)\w*/],
      ['Ancient history', /\b(ancient|antiquity)\w*/], ['Medieval history', /\b(medieval|middle ages)\w*/], ['Modern history', /\b(modern history|twentieth century|20th century)\w*/],
      ['Colonial history', /\b(colonialism|colonial rule|british empire|imperialism)\w*/], ['European history', /\b(european history|history of europe)\w*/],
      ['World history', /\b(world history|universal history)\w*/], ['Political history', /\b(political history)\w*/],
      ['Memoir', /\b(memoirs?|autobiograph)\w*/], ['Historical fiction', /\bhistorical fiction\b/], ['Science fiction', /\bscience fiction\b/],
      ['Ethics', /\bethics?\b/], ['Religion', /\b(religion|theology)\w*/], ['Islam', /\b(islam|muslim|qur.?an)\w*/],
      ['Science', /\b(science|physics|biology)\w*/], ['Politics', /\b(politics|political science|government)\w*/]
    ];
    return {category, tags:tagRules.filter(([, pattern]) => pattern.test(combined)).map(([name]) => name).slice(0, 4)};
  }
  function switchToForm(initial = {}, fromSearch = false) {
    hasSearchOrigin = fromSearch; $('#add-search-area').classList.add('hidden'); $('#book-form').classList.remove('hidden');
    $('#back-to-search').classList.toggle('hidden', !fromSearch);
    $('#field-title').value = initial.title || ''; $('#field-author').value = initial.author || '';
    $('#field-category').value = initial.category || 'Other'; $('#field-rating').value = initial.rating ? String(initial.rating) : '';
    $('#field-tags').value = (initial.tags || []).join(', '); currentCover = initial.cover || ''; currentSource = isSafeSource(initial.source) ? initial.source : '';
    $('#field-cover').value = currentCover.startsWith('https://') ? currentCover : ''; $('#cover-file').value = '';
    $('#form-note').textContent = fromSearch ? 'You can change every detail, including the suggested category and tags.' : 'Add your details and organize this book however you like.';
    $('#suggestion-hint').textContent = fromSearch ? 'Category and tags are simple suggestions based on catalog subjects. Please check them.' : 'Use any category name and add your own tags.';
    renderCoverPreview(); $('#field-title').focus();
  }
  function openAdd() {
    editingId = null; hasSearchOrigin = false; currentCover = ''; currentSource = '';
    $('#dialog-title').textContent = 'Add a book'; $('#form-heading').textContent = 'Book details'; $('#save-book').textContent = 'Save book';
    $('#book-form').reset(); $('#book-form').classList.add('hidden'); $('#add-search-area').classList.remove('hidden');
    $('#book-search').value = ''; $('#search-results').replaceChildren(); searchResults = [];
    if (!$('#book-dialog').open) $('#book-dialog').showModal(); setTimeout(() => $('#book-search').focus(), 0);
  }
  function editBook(id) {
    const book = books.find(b => b.id === id); if (!book) return;
    editingId = id; $('#dialog-title').textContent = 'Edit book'; $('#form-heading').textContent = 'Book details'; $('#save-book').textContent = 'Save changes';
    switchToForm(book); if (!$('#book-dialog').open) $('#book-dialog').showModal();
  }
  async function searchOpenLibrary(query) {
    const results = $('#search-results'); results.innerHTML = '<p class="search-state">Searching Open Library…</p>';
    const params = new URLSearchParams({ q:query, limit:'12', fields:'key,title,author_name,first_publish_year,cover_i,subject' });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`https://openlibrary.org/search.json?${params}`, {signal:controller.signal});
      if (!response.ok) throw new Error(`Search returned ${response.status}`);
      const payload = await response.json(); searchResults = Array.isArray(payload.docs) ? payload.docs : []; results.replaceChildren();
      if (!searchResults.length) { results.innerHTML = '<p class="search-state">No matching books found. Try different words or add it manually below.</p>'; return; }
      for (const doc of searchResults) {
        if (!doc.title) continue;
        const result = document.createElement('button'); result.type = 'button'; result.className = 'search-result';
        const cover = Number.isInteger(doc.cover_i) ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false` : '';
        result.append(makeCover(cover, doc.title, 'result-cover'));
        const info = document.createElement('span'); info.className = 'result-info'; const title = document.createElement('strong'); title.textContent = doc.title;
        const meta = document.createElement('span'); meta.textContent = [Array.isArray(doc.author_name) ? doc.author_name.slice(0, 2).join(', ') : '', doc.first_publish_year || ''].filter(Boolean).join(' · ') || 'Author unknown';
        info.append(title, meta); const arrow = document.createElement('span'); arrow.className = 'result-arrow'; arrow.innerHTML = icon('chevron'); result.append(info, arrow);
        result.addEventListener('click', () => {
          const inferred = inferBook(doc);
          switchToForm({title:doc.title, author:Array.isArray(doc.author_name) ? doc.author_name.slice(0, 3).join(', ') : '', category:inferred.category, tags:inferred.tags,
            cover:Number.isInteger(doc.cover_i) ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false` : '',
            source:typeof doc.key === 'string' && /^\/works\/OL\d+W$/.test(doc.key) ? `https://openlibrary.org${doc.key}` : ''}, true);
        }); results.append(result);
      }
    } catch (error) {
      results.innerHTML = '<p class="search-state">Couldn’t search right now. Check your connection and try again, or add your book manually below.</p>';
    } finally { clearTimeout(timer); }
  }
  async function compressCover(file) {
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new Error('Choose a JPEG, PNG, WebP, or AVIF image.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Please choose an image smaller than 20 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not read that image.')); });
      const ratio = Math.min(1, 800 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Could not process this image.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.83);
    } finally { URL.revokeObjectURL(url); }
  }
  async function saveBook(event) {
    event.preventDefault(); if (!db) return showToast('Local storage is unavailable. Your book was not saved.', 6000);
    const title = $('#field-title').value.trim(), rawCategory = $('#field-category').value.trim().replace(/\s+/g, ' ');
    if (!title || !rawCategory) return;
    const coverField = $('#field-cover').value.trim(); const cover = coverField || currentCover;
    if (!isSafeCover(cover)) { showToast('Use an HTTPS cover image URL or upload an image.'); return; }
    const now = new Date().toISOString(), previous = books.find(b => b.id === editingId);
    const knownCategory = categories().find(c => c.name.toLocaleLowerCase() === rawCategory.toLocaleLowerCase())?.name || rawCategory;
    const rating = $('#field-rating').value ? Number($('#field-rating').value) : null;
    const book = {id:editingId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`), title,
      author:$('#field-author').value.trim(), category:knownCategory, tags:cleanTags($('#field-tags').value), rating, cover, source:currentSource,
      createdAt:previous?.createdAt || now, updatedAt:now};
    try { await transactBooks([book]); books = await getBooks(); $('#book-dialog').close(); render(); showToast(editingId ? 'Book updated.' : 'Book added to your library.'); }
    catch (_) { showToast('Could not save your book. Check available device storage and try again.', 6500); }
  }
  function confirmAction(title, message, buttonText) {
    return new Promise(resolve => {
      const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-ok').textContent = buttonText;
      const finish = value => { dialog.close(); resolve(value); };
      $('#confirm-cancel').onclick = () => finish(false); $('#confirm-ok').onclick = () => finish(true);
      dialog.oncancel = event => { event.preventDefault(); finish(false); }; dialog.showModal();
    });
  }
  async function removeBook(id) {
    const book = books.find(b => b.id === id); if (!book || !(await confirmAction('Remove this book?', `“${book.title}” will be removed from your library. You can restore it from a backup.`, 'Remove book'))) return;
    try { await transactBooks([id], 'delete'); books = await getBooks(); render(); showToast('Book removed.'); } catch (_) { showToast('Could not remove the book. Please try again.'); }
  }
  function exportBackup() {
    if (!db) return showToast('Local storage is unavailable, so there is nothing to export.');
    const backup = {format:'the-reading-room',version:1,exportedAt:new Date().toISOString(),books};
    const file = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'}), url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = `reading-room-backup-${new Date().toISOString().slice(0,10)}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Backup downloaded. Keep it somewhere safe.');
  }
  function validateBackup(data) {
    if (!data || data.format !== 'the-reading-room' || data.version !== 1 || !Array.isArray(data.books)) throw new Error('This does not look like a Reading Room backup.');
    if (data.books.length > 10000) throw new Error('The backup is too large to import.');
    const ids = new Set();
    return data.books.map((b, i) => {
      if (!b || typeof b.id !== 'string' || !b.id || b.id.length > 200 || ids.has(b.id) || typeof b.title !== 'string' || !b.title.trim() || b.title.length > 240 || typeof b.category !== 'string' || !b.category.trim() || b.category.length > 80 || typeof b.cover !== 'string' || !isSafeCover(b.cover) || b.cover.length > 4_000_000 || !(b.rating === null || (Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 10))) throw new Error(`Book ${i+1} in the backup is invalid.`);
      ids.add(b.id);
      return {id:b.id, title:b.title.trim(), author:typeof b.author === 'string' ? b.author.slice(0,200) : '', category:b.category.trim(), tags:cleanTags(b.tags), rating:b.rating, cover:b.cover,
        source:isSafeSource(b.source) ? b.source : '', createdAt:typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(), updatedAt:typeof b.updatedAt === 'string' ? b.updatedAt : new Date().toISOString()};
    });
  }
  async function importBackup(file) {
    if (!file) return; if (!db) return showToast('Local storage is unavailable.');
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('Please choose a backup smaller than 100 MB.');
      const incoming = validateBackup(JSON.parse(await file.text()));
      const existing = new Set(books.map(b => b.id)); const matches = incoming.filter(b => existing.has(b.id)).length;
      const message = `This backup contains ${incoming.length} ${incoming.length === 1 ? 'book' : 'books'}. It will add new books${matches ? ` and update ${matches} matching ${matches === 1 ? 'book' : 'books'}` : ''}. Other books already here will stay.`;
      if (!(await confirmAction('Import this backup?', message, 'Import backup'))) return;
      await transactBooks(incoming); books = await getBooks(); render(); showToast(`Imported ${incoming.length} ${incoming.length === 1 ? 'book' : 'books'}.`);
    } catch (error) { showToast(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message || 'Could not import the backup.', 7000); }
  }
  function wire() {
    $$('[data-view]').forEach(node => node.addEventListener('click', () => { if (node.dataset.view === 'library') categoryFilter = ''; changeView(node.dataset.view); }));
    $$('.add-book').forEach(node => node.addEventListener('click', openAdd)); $('.go-library').addEventListener('click', () => {categoryFilter = ''; changeView('library');});
    $('#library-search').addEventListener('input', renderLibrary); $('#category-filter').addEventListener('change', e => { categoryFilter = e.target.value; renderLibrary(); });
    $('#export-btn').addEventListener('click', exportBackup); $('#mobile-backup').addEventListener('click', () => $('#backup-dialog').showModal());
    $('#mobile-export').addEventListener('click', () => { $('#backup-dialog').close(); exportBackup(); });
    $('#mobile-import').addEventListener('click', () => { $('#backup-dialog').close(); $('#import-file').click(); });
    $('#mobile-backup-close').addEventListener('click', () => $('#backup-dialog').close());
    $('#import-btn').addEventListener('click', () => $('#import-file').click()); $('#import-file').addEventListener('change', async e => { await importBackup(e.target.files[0]); e.target.value = ''; });
    $('#close-dialog').addEventListener('click', () => $('#book-dialog').close()); $('#cancel-form').addEventListener('click', () => $('#book-dialog').close());
    $('#manual-add').addEventListener('click', () => switchToForm({title:$('#book-search').value.trim()}));
    $('#back-to-search').addEventListener('click', () => { $('#book-form').classList.add('hidden'); $('#add-search-area').classList.remove('hidden'); $('#book-search').focus(); });
    $('#book-search-form').addEventListener('submit', e => {e.preventDefault(); const query = $('#book-search').value.trim(); if (query) searchOpenLibrary(query);});
    $('#book-form').addEventListener('submit', saveBook); $('#field-title').addEventListener('input', renderCoverPreview);
    $('#field-cover').addEventListener('input', e => { currentCover = e.target.value.trim(); renderCoverPreview(); });
    $('#remove-cover').addEventListener('click', () => { currentCover = ''; $('#field-cover').value = ''; $('#cover-file').value = ''; renderCoverPreview(); });
    $('#cover-file').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; try { currentCover = await compressCover(file); $('#field-cover').value = ''; renderCoverPreview(); showToast('Cover added. Save the book to keep it.'); } catch (error) { showToast(error.message || 'Could not use that image.'); } });
  }
  async function init() {
    wire();
    try { db = await openDb(); books = await getBooks(); render(); }
    catch (_) { render(); showToast('Local storage is unavailable in this browser. Allow site storage before adding books.', 10000); }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  init();
})();
