pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 各ページの情報を一元管理するメイン配列
let masterPages = [];          
let selectedPages = new Set(); 

// 読み込んだファイルの「Blob URL」を安全に保管する配列（これでブラウザに勝手に消されなくなります）
let loadedBlobUrlsPool = [];

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const controls = document.getElementById('controls');
const hintText = document.getElementById('hint-text');
const thumbnailContainer = document.getElementById('thumbnail-container');

// --- イベントリスナー ---
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFiles(e.target.files);
});

document.getElementById('btn-left').addEventListener('click', () => rotateSelected(-90));
document.getElementById('btn-right').addEventListener('click', () => rotateSelected(90));
document.getElementById('btn-180').addEventListener('click', () => rotateSelected(180));
document.getElementById('btn-delete').addEventListener('click', deleteSelectedPages);
document.getElementById('btn-download').addEventListener('click', downloadPdf);

// --- 複数PDF対応・ファイル読み込み処理 ---
async function handleFiles(files) {
    thumbnailContainer.innerHTML = 'PDFを解析・処理中...';
    controls.classList.add('hidden');
    hintText.classList.add('hidden');

    for (let f of files) {
        if (f.type !== 'application/pdf') continue;

        await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async function(e) {
                const arrayBuffer = e.target.result;
                const pdfBytes = new Uint8Array(arrayBuffer);
                
                // 【超重要】データをただの変数ではなく「Blob URL」にしてブラウザのストレージにがっちり固定保存する
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const storageUrl = URL.createObjectURL(blob);
                
                const fileIndex = loadedBlobUrlsPool.length;
                loadedBlobUrlsPool.push(storageUrl);

                try {
                    // 読み込みもBlob URLから行う
                    const pdf = await pdfjsLib.getDocument(storageUrl).promise;
                    
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const pageId = `page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                        
                        masterPages.push({
                            id: pageId,
                            fileIndex: fileIndex, 
                            originalPageIndex: i - 1,
                            currentRotation: 0,
                            pageData: page
                        });
                    }
                } catch (error) {
                    alert(`読み込みに失敗しました: ` + error.message);
                }
                resolve();
            };
            reader.readAsArrayBuffer(f);
        });
    }

    renderAllThumbnails();
}

// --- 全サムネイルの描画 ---
async function renderAllThumbnails() {
    thumbnailContainer.innerHTML = '';
    
    if (masterPages.length === 0) {
        controls.classList.add('hidden');
        hintText.classList.add('hidden');
        return;
    }

    for (let i = 0; i < masterPages.length; i++) {
        await createThumbnailCard(masterPages[i], i + 1);
    }

    controls.classList.remove('hidden');
    hintText.classList.remove('hidden');
    setupDragAndDropSort(); 
}

// --- サムネイルカードの生成 ---
async function createThumbnailCard(pObj, displayIndex) {
    const viewport = pObj.pageData.getViewport({ scale: 0.3 });

    const card = document.createElement('div');
    card.className = 'page-card';
    card.draggable = true; 
    card.dataset.id = pObj.id;
    if (selectedPages.has(pObj.id)) card.classList.add('selected');

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    canvas.style.transform = `rotate(${pObj.currentRotation}deg)`;

    wrapper.appendChild(canvas);
    card.appendChild(wrapper);

    const pageNumLabel = document.createElement('div');
    pageNumLabel.className = 'page-number';
    pageNumLabel.innerText = `${displayIndex} ページ`;
    card.appendChild(pageNumLabel);

    thumbnailContainer.appendChild(card);

    await pObj.pageData.render({ canvasContext: context, viewport: viewport }).promise;

    card.addEventListener('click', () => {
        if (card.classList.contains('dragging')) return;

        if (selectedPages.has(pObj.id)) {
            selectedPages.delete(pObj.id);
            card.classList.remove('selected');
        } else {
            selectedPages.add(pObj.id);
            card.classList.add('selected');
        }
    });
}

// --- 並び替え機能（HTML5 Drag and Drop） ---
function setupDragAndDropSort() {
    const cards = document.querySelectorAll('.page-card');
    
    cards.forEach(card => {
        card.addEventListener('dragstart', () => card.classList.add('dragging'));
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            
            const currentCards = Array.from(thumbnailContainer.querySelectorAll('.page-card'));
            const newMasterPages = [];
            
            currentCards.forEach(c => {
                const id = c.dataset.id;
                const found = masterPages.find(p => p.id === id);
                if (found) newMasterPages.push(found);
            });
            
            masterPages = newMasterPages;
            
            const labels = thumbnailContainer.querySelectorAll('.page-number');
            labels.forEach((label, idx) => {
                label.innerText = `${idx + 1} ページ`;
            });
        });
    });

    thumbnailContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(thumbnailContainer, e.clientX, e.clientY);
        const draggingCard = document.querySelector('.page-card.dragging');
        if (draggingCard) {
            if (afterElement == null) {
                thumbnailContainer.appendChild(draggingCard);
            } else {
                thumbnailContainer.insertBefore(draggingCard, afterElement);
            }
        }
    });
}

function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.page-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- 回転処理 ---
function rotateSelected(degree) {
    if (selectedPages.size === 0) {
        alert('操作したいページをクリックして選択してください。');
        return;
    }

    selectedPages.forEach(id => {
        const pObj = masterPages.find(p => p.id === id);
        if (pObj) {
            let newRotation = (pObj.currentRotation + degree) % 360;
            if (newRotation < 0) newRotation += 360;
            pObj.currentRotation = newRotation;

            const card = document.querySelector(`.page-card[data-id="${id}"]`);
            if (card) {
                const canvas = card.querySelector('canvas');
                canvas.style.transform = `rotate(${newRotation}deg)`;
            }
        }
    });
}

// --- ページ削除機能 ---
function deleteSelectedPages() {
    if (selectedPages.size === 0) {
        alert('削除したいページをクリックして選択してください。');
        return;
    }

    if (!confirm(`選択された ${selectedPages.size} つのページを削除しますか？`)) {
        return;
    }

    masterPages = masterPages.filter(p => !selectedPages.has(p.id));
    selectedPages.clear();

    renderAllThumbnails();
}

// --- ダウンロード処理 ---
async function downloadPdf() {
    if (masterPages.length === 0) return;

    const downloadBtn = document.getElementById('btn-download');
    const originalText = downloadBtn.innerText;
    downloadBtn.innerText = '⏳ PDFを処理中...';
    downloadBtn.disabled = true;

    try {
        const { PDFDocument, degrees } = window.PDFLib;
        const finalPdfDoc = await PDFDocument.create();

        // ページごとに、絶対に消えないBlob URLからその都度データをフェッチして再構築する
        for (let pObj of masterPages) {
            const blobUrl = loadedBlobUrlsPool[pObj.fileIndex];
            if (!blobUrl) {
                throw new Error("元のファイルURLを見失いました。");
            }

            // 安全なURLからバイナリデータを引っ張ってくる
            const response = await fetch(blobUrl);
            const arrayBuffer = await response.arrayBuffer();
            
            const sourceDoc = await PDFDocument.load(new Uint8Array(arrayBuffer));
            const [copiedPage] = await finalPdfDoc.copyPages(sourceDoc, [pObj.originalPageIndex]);
            
            if (pObj.currentRotation !== 0) {
                const existingRotation = copiedPage.getRotation().angle;
                const finalRotation = (existingRotation + pObj.currentRotation) % 360;
                copiedPage.setRotation(degrees(finalRotation));
            }

            finalPdfDoc.addPage(copiedPage);
        }

        const pdfBytes = await finalPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const fileUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = 'edited_document.pdf';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setTimeout(() => URL.revokeObjectURL(fileUrl), 3000);

    } catch (error) {
        console.error(error);
        alert('PDFの編集出力中にエラーが発生しました: ' + error.message);
    } finally {
        downloadBtn.innerText = originalText;
        downloadBtn.disabled = false;
    }
}