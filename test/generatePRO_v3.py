import os
import io
import json
import math
import re
import shutil
from PIL import Image, ImageFilter

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

INPUT_DIR = "images"
OUTPUT_DIR = "tiles"
DATA_JS_PATH = "data.js"
TILE_SIZE = 512

QUALITY_PRESETS = {
    "1": {"name": "Эконом (высокое сжатие для медленного интернета)", "quality": 65},
    "2": {"name": "Оптимальный (баланс качества и веса для веба)",     "quality": 75},
    "3": {"name": "Высокий (максимальная детализация, стандарт)",    "quality": 85},
    "4": {"name": "Без потери качества (оригинал 100%, большой вес)", "quality": 100},
}

FORMAT_OPTIONS = {
    "1": {"name": "JPEG (.jpg)", "ext": "jpg",  "pil_format": "JPEG"},
    "2": {"name": "WebP (.webp)", "ext": "webp", "pil_format": "WEBP"},
}

def get_max_face_size_for_image(width, height, upscale_x2=False):
    if upscale_x2 and width < 5000:
        width *= 2
        height *= 2
    if width < 6000 or height < 3000:
        return 1024
    return 2048

def equirect_to_cube_face(img, face, face_size):
    src_width, src_height = img.size

    if HAS_NUMPY:
        src_arr = np.asarray(img)
        coords = np.linspace(-1.0, 1.0, face_size, dtype=np.float32)
        a, b = np.meshgrid(coords, coords)

        if face == 'r':   vx, vy, vz = np.ones_like(a), b, -a
        elif face == 'l': vx, vy, vz = -np.ones_like(a), b, a
        elif face == 'u': vx, vy, vz = a, -np.ones_like(a), b
        elif face == 'd': vx, vy, vz = a, np.ones_like(a), -b
        elif face == 'f': vx, vy, vz = a, b, np.ones_like(a)
        elif face == 'b': vx, vy, vz = -a, b, -np.ones_like(a)
        else: vx, vy, vz = np.zeros_like(a), np.zeros_like(a), np.zeros_like(a)

        phi = np.arctan2(vx, vz)
        theta = np.arctan2(vy, np.sqrt(vx * vx + vz * vz))

        u = (phi + np.pi) / (2.0 * np.pi) * src_width - 0.5
        v = (theta + np.pi / 2.0) / np.pi * src_height - 0.5

        u0 = np.floor(u).astype(np.int32)
        v0 = np.floor(v).astype(np.int32)
        du = (u - u0)[..., None]
        dv = (v - v0)[..., None]

        u0_c = np.mod(u0, src_width)
        u1_c = np.mod(u0 + 1, src_width)
        v0_c = np.clip(v0, 0, src_height - 1)
        v1_c = np.clip(v0 + 1, 0, src_height - 1)

        c00 = src_arr[v0_c, u0_c].astype(np.float32)
        c10 = src_arr[v0_c, u1_c].astype(np.float32)
        c01 = src_arr[v1_c, u0_c].astype(np.float32)
        c11 = src_arr[v1_c, u1_c].astype(np.float32)

        cube_arr = (
            c00 * (1.0 - du) * (1.0 - dv) +
            c10 * du * (1.0 - dv) +
            c01 * (1.0 - du) * dv +
            c11 * du * dv
        ).astype(np.uint8)
        return Image.fromarray(cube_arr)

    cube_img = Image.new("RGB", (face_size, face_size))
    pixels = cube_img.load()
    src_pixels = img.load()

    for i in range(face_size):
        for j in range(face_size):
            a = 2.0 * i / (face_size - 1) if face_size > 1 else 0
            b = 2.0 * j / (face_size - 1) if face_size > 1 else 0
            a -= 1.0
            b -= 1.0

            if face == 'r':   vx, vy, vz =  1.0,   b,  -a
            elif face == 'l': vx, vy, vz = -1.0,   b,   a
            elif face == 'u': vx, vy, vz =   a, -1.0,   b
            elif face == 'd': vx, vy, vz =   a,  1.0,  -b
            elif face == 'f': vx, vy, vz =   a,   b,   1.0
            elif face == 'b': vx, vy, vz =  -a,   b,  -1.0
            else: vx, vy, vz = 0, 0, 0

            phi = math.atan2(vx, vz)
            theta = math.atan2(vy, math.sqrt(vx*vx + vz*vz))

            ui = int((phi + math.pi) / (2.0 * math.pi) * src_width)
            vi = int((theta + math.pi / 2.0) / math.pi * src_height)

            ui = max(0, min(ui, src_width - 1))
            vi = max(0, min(vi, src_height - 1))

            pixels[i, j] = src_pixels[ui, vi]
    return cube_img

def save_image_tile(image_obj, target, pil_format, quality):
    if pil_format == "WEBP":
        if quality >= 100:
            image_obj.save(target, "WEBP", lossless=True, quality=100, method=4)
        else:
            image_obj.save(target, "WEBP", quality=quality, method=4)
    else:
        if quality >= 100:
            image_obj.save(target, "JPEG", quality=100, subsampling=0, optimize=True)
        else:
            image_obj.save(target, "JPEG", quality=quality, optimize=True, progressive=True)

def select_output_format():
    print("\nВыберите формат выходных тайлов:")
    for key, f_data in FORMAT_OPTIONS.items():
        print(f" [{key}] {f_data['name']}")

    while True:
        choice = input("\nВведите номер формата (1 - jpg, 2 - webp, Enter = 1): ").strip()
        if not choice:
            return FORMAT_OPTIONS["1"]
        if choice in FORMAT_OPTIONS:
            return FORMAT_OPTIONS[choice]
        print("Ошибка: введите 1 или 2.")

def get_effective_quality(base_quality, is_upscaled):
    if not is_upscaled or base_quality >= 100:
        return base_quality
    # Для апскейла снижаем избыточный битрейт на 8%, сохраняя визуальную четкость
    return max(58, base_quality - 8)

def estimate_files_sizes(files_list, fmt_data, upscale_x2=False):
    pil_format = fmt_data["pil_format"]
    print(f"\nАнализ исходников и расчёт будущего веса тайлов ({fmt_data['name']})...")
    estimates = []
    
    for item in files_list:
        img_path = os.path.join(INPUT_DIR, item["filename"])
        orig_mb = os.path.getsize(img_path) / (1024 * 1024)
        img = Image.open(img_path).convert("RGB")
        w, h = img.size
        is_upscaled = bool(upscale_x2 and w < 5000)
        
        max_f_size = get_max_face_size_for_image(w, h, is_upscaled)
        sample_face = equirect_to_cube_face(img, 'f', max_f_size)
        if is_upscaled:
            sample_face = sample_face.filter(ImageFilter.UnsharpMask(radius=1.0, percent=80, threshold=3))
        
        level_multiplier = 1.38 if max_f_size == 2048 else 1.32
        
        preset_sizes = {}
        for key, p_data in QUALITY_PRESETS.items():
            q = get_effective_quality(p_data["quality"], is_upscaled)
            buf = io.BytesIO()
            save_image_tile(sample_face, buf, pil_format, q)
            max_face_bytes = buf.tell()
            
            total_bytes = max_face_bytes * 6 * level_multiplier
            preset_sizes[key] = total_bytes / (1024 * 1024)
            
        estimates.append({
            "filename": item["filename"],
            "scene_id": item["scene_id"],
            "orig_mb": orig_mb,
            "resolution": f"{w}x{h}",
            "max_face_size": max_f_size,
            "sizes": preset_sizes
        })
    return estimates

def select_quality_preset(files_list, fmt_data, upscale_x2=False):
    estimates = estimate_files_sizes(files_list, fmt_data, upscale_x2=upscale_x2)
    
    print(f"\n=== ПРОГНОЗ ВЕСА ПАПОК ПОСЛЕ НАРЕЗКИ ({fmt_data['name']}) ===")
    for est in estimates:
        limit_note = " [лимит 1024px — без дублирования пикселей]" if est["max_face_size"] < 2048 else ""
        print(
            f" • {est['filename']} ({est['resolution']}, {est['orig_mb']:.2f} МБ){limit_note} -> "
            f"[1] ~{est['sizes']['1']:.2f} МБ | "
            f"[2] ~{est['sizes']['2']:.2f} МБ | "
            f"[3] ~{est['sizes']['3']:.2f} МБ | "
            f"[4] ~{est['sizes']['4']:.2f} МБ"
        )
        
    tot_1 = sum(e["sizes"]["1"] for e in estimates)
    tot_2 = sum(e["sizes"]["2"] for e in estimates)
    tot_3 = sum(e["sizes"]["3"] for e in estimates)
    tot_4 = sum(e["sizes"]["4"] for e in estimates)
    print("-" * 50)
    print(f" ИТОГО ЗА ВСЕ ({len(estimates)} шт.): [1] ~{tot_1:.2f} МБ | [2] ~{tot_2:.2f} МБ | [3] ~{tot_3:.2f} МБ | [4] ~{tot_4:.2f} МБ\n")

    print("Выберите вариант качества перед нарезкой:")
    for key, p_data in QUALITY_PRESETS.items():
        print(f" [{key}] {p_data['name']} — {p_data['quality']}%")

    while True:
        choice = input("\nВведите номер варианта (1, 2, 3 или 4, Enter = 2): ").strip()
        if not choice:
            return QUALITY_PRESETS["2"]["quality"]
        if choice in QUALITY_PRESETS:
            return QUALITY_PRESETS[choice]["quality"]
        print("Ошибка: введите 1, 2, 3 или 4.")

def create_vertical_cube_preview(faces_dict, face_size=256):
    faces_order = ['b', 'd', 'f', 'l', 'r', 'u']
    preview_img = Image.new("RGB", (face_size, face_size * 6))
    
    for idx, face in enumerate(faces_order):
        face_resized = faces_dict[face].resize((face_size, face_size), Image.Resampling.LANCZOS)
        preview_img.paste(face_resized, (0, idx * face_size))
        
    return preview_img

def get_folder_size_mb(folder_path):
    total_size = 0
    for dirpath, _, filenames in os.walk(folder_path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.exists(fp):
                total_size += os.path.getsize(fp)
    return total_size / (1024 * 1024)

def process_panorama(img_path, scene_id, tile_quality=75, fmt_data=None, upscale_x2=False):
    if fmt_data is None:
        fmt_data = FORMAT_OPTIONS["1"]
    pil_format = fmt_data["pil_format"]
    ext = fmt_data["ext"]

    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    is_upscaled = bool(upscale_x2 and w < 5000)
    eff_quality = get_effective_quality(tile_quality, is_upscaled)
    upscaled_note = f" [upscale x2 + резкость, оптим. Q={eff_quality}%]" if is_upscaled else ""
    max_face_size = get_max_face_size_for_image(w, h, is_upscaled)
    
    print(f"Нарезка: {img_path} ({w}x{h}{upscaled_note} -> грань {max_face_size}px, формат {ext.upper()})...")
    
    scene_root_dir = os.path.join(OUTPUT_DIR, scene_id)
    if os.path.exists(scene_root_dir):
        shutil.rmtree(scene_root_dir)
    os.makedirs(scene_root_dir, exist_ok=True)

    faces = ['b', 'd', 'f', 'l', 'r', 'u']
    generated_faces = {}
    for face in faces:
        face_img = equirect_to_cube_face(img, face, max_face_size)
        if is_upscaled:
            face_img = face_img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=80, threshold=3))
        generated_faces[face] = face_img

    preview_quality = min(eff_quality, 70)
    preview_img = create_vertical_cube_preview(generated_faces, face_size=256)
    save_image_tile(
        preview_img,
        os.path.join(scene_root_dir, f"preview.{ext}"),
        pil_format,
        preview_quality
    )

    levels_config = [
        {"id": "1", "face_size": 512,  "tile_size": 512}, 
        {"id": "2", "face_size": 1024, "tile_size": 512}, 
    ]
    if max_face_size >= 2048:
        levels_config.append({"id": "3", "face_size": 2048, "tile_size": 512})

    for lvl in levels_config:
        z_id = lvl["id"]
        f_size = lvl["face_size"]
        t_size = lvl["tile_size"]
        tiles_per_edge = f_size // t_size

        for face in faces:
            if f_size == max_face_size:
                level_face_img = generated_faces[face]
            else:
                level_face_img = generated_faces[face].resize((f_size, f_size), Image.Resampling.LANCZOS)
                
            for y in range(tiles_per_edge):
                for x in range(tiles_per_edge):
                    box = (x * t_size, y * t_size, (x + 1) * t_size, (y + 1) * t_size)
                    tile = level_face_img.crop(box)
                    tile_dir = os.path.join(scene_root_dir, z_id, face, str(y))
                    os.makedirs(tile_dir, exist_ok=True)
                    save_image_tile(
                        tile,
                        os.path.join(tile_dir, f"{x}.{ext}"),
                        pil_format,
                        eff_quality
                    )
                    
    final_size = get_folder_size_mb(scene_root_dir)
    print(f" -> Готово! Фактический вес '{scene_root_dir}': {final_size:.2f} МБ")
    return max_face_size

def ask_confirm(prompt):
    while True:
        ans = input(f"{prompt} (y/n): ").strip().lower()
        if ans in ['y', 'yes', 'да', 'д']: return True
        if ans in ['n', 'no', 'нет', 'н']: return False

def load_existing_data_js():
    if not os.path.exists(DATA_JS_PATH): return None
    try:
        with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
            content = f.read().strip()
        match = re.search(r"var\s+APP_DATA\s*=\s*(\{.*\});", content, re.DOTALL)
        if match: return json.loads(match.group(1))
    except Exception as e:
        print(f"Предупреждение: Не удалось прочесть существующий data.js ({e})")
    return None

def rebuild_all_hotspots(scenes):
    for scene in scenes:
        if "linkHotspots" not in scene:
            scene["linkHotspots"] = []
    return scenes

def build_levels_array(max_face_size=2048):
    levels = [
        { "tileSize": 256, "size": 256, "fallbackOnly": True },
        { "tileSize": 512, "size": 512 },
        { "tileSize": 512, "size": 1024 },
    ]
    if max_face_size >= 2048:
        levels.append({ "tileSize": 512, "size": 2048 })
    return levels

def build_scene_data(scene_id, pure_name, max_face_size=2048):
    return {
        "id": scene_id,
        "name": pure_name,  
        "mapCoords": { "left": "50%", "top": "50%" },
        "levels": build_levels_array(max_face_size),
        "faceSize": max_face_size,
        "initialViewParameters": { "yaw": 0.0, "pitch": 0.0, "fov": 1.2 },
        "linkHotspots": [], 
        "infoHotspots": []
    }

def detect_tiles_structure(tiles_folders, existing_scenes, existing_settings):
    detected_ext = existing_settings.get("tileFormat", "webp")
    scenes_map = {s["id"]: s for s in existing_scenes}
    result_scenes = []

    for t in tiles_folders:
        sid = t["full"]
        scene_dir = os.path.join(OUTPUT_DIR, sid)
        for ext_candidate in ("webp", "jpg", "jpeg", "png"):
            if os.path.exists(os.path.join(scene_dir, f"preview.{ext_candidate}")):
                detected_ext = ext_candidate
                break
        max_face = 2048 if os.path.isdir(os.path.join(scene_dir, "3")) else 1024
        if sid in scenes_map:
            sc = scenes_map[sid]
            sc["faceSize"] = max_face
            sc["levels"] = build_levels_array(max_face)
            result_scenes.append(sc)
        else:
            result_scenes.append(build_scene_data(sid, t["clean"], max_face))

    return result_scenes, detected_ext

def generate_tour():
    has_images_dir = os.path.exists(INPUT_DIR)
    if not has_images_dir and not os.path.exists(OUTPUT_DIR):
        print(f"Ошибка: Создайте папку '{INPUT_DIR}' с исходниками или поместите готовые тайлы в '{OUTPUT_DIR}'.")
        return

    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR, exist_ok=True)

    if HAS_NUMPY:
        print("[OK] Библиотека NumPy активна (ускоренная нарезка).")
    else:
        print("[ИНФО] NumPy не найден, используется стандартный режим нарезки.")

    image_extensions = (".jpg", ".jpeg", ".png", ".webp")
    images_in_folder = []
    if has_images_dir:
        for f in sorted(os.listdir(INPUT_DIR)):
            if f.lower().endswith(image_extensions):
                images_in_folder.append({
                    "pure_name": os.path.splitext(f)[0],
                    "filename": f
                })
    else:
        print(f"[ИНФО] Папка '{INPUT_DIR}' не найдена — работаем в режиме анализа существующей папки '{OUTPUT_DIR}'.")
    
    tiles_folders = []
    tour_data = load_existing_data_js()
    existing_scenes = tour_data["scenes"] if (tour_data and "scenes" in tour_data) else []
    existing_settings = tour_data["settings"] if (tour_data and "settings" in tour_data) else {}

    for d in os.listdir(OUTPUT_DIR):
        if os.path.isdir(os.path.join(OUTPUT_DIR, d)):
            match = re.match(r"^(\d+)$", d)
            if match:
                clean_name = d
                if existing_scenes:
                    scene_match = next((s for s in existing_scenes if s["id"] == d), None)
                    if scene_match: clean_name = scene_match["name"]
                tiles_folders.append({
                    "full": d,
                    "index": int(match.group(1)),
                    "clean": clean_name
                })
    tiles_folders.sort(key=lambda x: x["index"])

    img_set = set(img["pure_name"] for img in images_in_folder)
    tile_set = set(t["clean"] for t in tiles_folders)

    slice_needed = False
    files_to_process = []
    is_incremental = False

    if not tiles_folders:
        if not images_in_folder:
            print(f"В папке '{INPUT_DIR}' не найдено картинок. Нечего нарезать.")
            return
        print(f"\nПапка '{OUTPUT_DIR}' пуста. Найдено файлов для нарезки: {len(images_in_folder)}")
        
        while True:
            choice = input("Нарезаем [все] тайлы или [выборочно]? (все/выборочно/отмена, Enter = все): ").strip().lower()
            if not choice or choice in ['все', 'в', 'all', 'a']:
                slice_needed = True
                for idx, img in enumerate(images_in_folder):
                    files_to_process.append({
                        "pure_name": img["pure_name"], 
                        "filename": img["filename"], 
                        "scene_id": f"{idx + 1}"
                    })
                existing_scenes = []
                break
            elif choice in ['выборочно', 'выбор', 's', 'select']:
                print("\nСписок картинок в папке /images:")
                for idx, img in enumerate(images_in_folder):
                    print(f" [{idx + 1}] {img['filename']}")
                
                user_input = input("\nУкажите номера картинок через запятую (напр.: 1, 3): ").strip()
                if user_input:
                    try:
                        chosen_indices = [int(x.strip()) - 1 for x in user_input.split(",") if x.strip().isdigit()]
                        chosen_indices = sorted(list(set(chosen_indices)))
                        
                        for new_idx, idx in enumerate(chosen_indices):
                            if 0 <= idx < len(images_in_folder):
                                img = images_in_folder[idx]
                                slice_needed = True
                                files_to_process.append({
                                    "pure_name": img["pure_name"], 
                                    "filename": img["filename"], 
                                    "scene_id": f"{new_idx + 1}" 
                                })
                        existing_scenes = []
                    except Exception as e:
                        print(f"Ошибка при разборе номеров: {e}. Нарезка отменена.")
                break
            elif choice in ['отмена', 'о', 'n', 'exit']:
                print("Нарезка отменена пользователем.")
                break
    elif not tile_set.issubset(img_set):
        print("\n[ИНФОРМАЦИЯ] В папке /tiles обнаружены папки, для которых нет исходных картинок в /images:")
        for t in tiles_folders:
            if t["clean"] not in img_set:
                print(f" - Существующая папка тайлов: '{t['full']}' (оригинальное имя: {t['clean']})")
        
        new_images_names = img_set - tile_set
        if new_images_names:
            print(f"\nПри этом найдены новые картинки в '{INPUT_DIR}' ({len(new_images_names)} шт.):")
            for n in sorted(new_images_names):
                print(f" + Новая панорама: {n}")
            if ask_confirm("\nНарезать новые картинки? (старые папки тайлов останутся без изменений)"):
                slice_needed = True
                is_incremental = True
                start_index = max([t["index"] for t in tiles_folders]) + 1
                new_files = [img for img in images_in_folder if img["pure_name"] in new_images_names]
                for idx, img in enumerate(new_files):
                    files_to_process.append({
                        "pure_name": img["pure_name"], 
                        "filename": img["filename"], 
                        "scene_id": f"{start_index + idx}"
                    })
        else:
            print("\nНовых картинок для дорезки в /images не обнаружено.")

    else:
        new_images_names = img_set - tile_set
        if img_set == tile_set:
            print(f"\n[СИНХРОНИЗАЦИЯ] Структура папок '{OUTPUT_DIR}' совпадает с файлами в '{INPUT_DIR}'.")
            print("Названия идентичны, изменений в структуре нет.")
        else:
            print(f"\n[СИНХРОНИЗАЦИЯ] Обнаружены изменения! Все старые файлы на месте, но есть новые.")
            print(f"Найдено новых картинок в '{INPUT_DIR}' ({len(new_images_names)} шт.):")
            for n in sorted(new_images_names):
                print(f" + Новая панорама: {n}")

        if new_images_names:
            if ask_confirm("\nНарезать новые картинки? (старые останутся без изменений)"):
                slice_needed = True
                is_incremental = True
                start_index = max([t["index"] for t in tiles_folders]) + 1
                new_files = [img for img in images_in_folder if img["pure_name"] in new_images_names]
                for idx, img in enumerate(new_files):
                    files_to_process.append({
                        "pure_name": img["pure_name"], 
                        "filename": img["filename"], 
                        "scene_id": f"{start_index + idx}"
                    })

    if tiles_folders:
        available_for_replace = [t for t in tiles_folders if t["clean"] in img_set]
        if available_for_replace:
            if ask_confirm("\nЖелаете переписать/обновить какие-то из доступных существующих панорам?"):
                print("\nСписок доступных для обновления сцен:")
                for idx, t in enumerate(available_for_replace):
                    print(f" [{idx + 1}] ID: {t['full']} (Имя: {t['clean']})")
                
                user_input = input("\nУкажите номера сцен через запятую (например: 1, 3): ").strip()
                if user_input:
                    try:
                        chosen_indices = [int(x.strip()) - 1 for x in user_input.split(",") if x.strip().isdigit()]
                        for idx in chosen_indices:
                            if 0 <= idx < len(available_for_replace):
                                target_tile = available_for_replace[idx]
                                img_match = next((img for img in images_in_folder if img["pure_name"] == target_tile["clean"]), None)
                                if img_match:
                                    slice_needed = True
                                    is_incremental = True
                                    if not any(f["scene_id"] == target_tile["full"] for f in files_to_process):
                                        files_to_process.append({
                                            "pure_name": target_tile["clean"],
                                            "filename": img_match["filename"],
                                            "scene_id": target_tile["full"]
                                        })
                                        print(f" -> Добавлено в очередь на замену: ID {target_tile['full']}")
                    except Exception as e:
                        print(f"Ошибка при разборе номеров: {e}. Выборочное обновление пропущено.")

    if is_incremental and not existing_scenes:
        for t in tiles_folders:
            existing_scenes.append(build_scene_data(t["full"], t["clean"], 2048))

    if slice_needed and files_to_process:
        small_files = []
        for item in files_to_process:
            with Image.open(os.path.join(INPUT_DIR, item["filename"])) as im:
                if im.size[0] < 5000:
                    small_files.append(f"{item['filename']} ({im.size[0]}x{im.size[1]})")

        do_upscale = False
        if small_files:
            print(f"\n[ИНФО] Обнаружены панорамы с шириной менее 5000px ({len(small_files)} шт.):")
            for sf in small_files:
                print(f" - {sf}")
            do_upscale = ask_confirm("Выполнить upscale x2 перед нарезкой (чтобы нарезать грани 2048px)?")

        selected_format = select_output_format()
        selected_quality = select_quality_preset(files_to_process, selected_format, upscale_x2=do_upscale)
        processed_folders = []
        
        for item in files_to_process:
            img_path = os.path.join(INPUT_DIR, item["filename"])
            scene_id = item["scene_id"]
            pure_name = item["pure_name"]
            
            used_face_size = process_panorama(
                img_path, 
                scene_id, 
                tile_quality=selected_quality, 
                fmt_data=selected_format,
                upscale_x2=do_upscale
            )
            if scene_id not in processed_folders:
                processed_folders.append(scene_id)
            
            existing_block = next((s for s in existing_scenes if s["id"] == scene_id), None)
            if existing_block:
                existing_block["name"] = pure_name
                existing_block["faceSize"] = used_face_size
                existing_block["levels"] = build_levels_array(used_face_size)
            else:
                existing_scenes.append(build_scene_data(scene_id, pure_name, used_face_size))

        print("\n=== ОТЧЕТ О НАРЕЗКЕ ТАЙЛОВ ===")
        print(f"Тайлы успешно обработаны (формат: {selected_format['name']}, качество: {selected_quality}%)!")
        print("Созданные/Обновленные папки панорам:")
        for folder in processed_folders:
            print(f" - {OUTPUT_DIR}/{folder}")
        print(f"Напоминание: убедитесь, что в index.js указано расширение .{selected_format['ext']} (или оно берется из data.settings.tileFormat).")
        print("==============================\n")

        def get_scene_index(scene):
            match = re.match(r"^(\d+)$", scene["id"])
            return int(match.group(1)) if match else 0
            
        existing_scenes.sort(key=get_scene_index)
        all_scenes = rebuild_all_hotspots(existing_scenes)

        write_data_js = False
        data_js_exists = os.path.exists(DATA_JS_PATH)

        if not data_js_exists:
            write_data_js = True
        else:
            prompt_text = (
                f"Файл '{DATA_JS_PATH}' уже существует. Обновить измененные/новые сцены в нем?" 
                if is_incremental else 
                f"Файл '{DATA_JS_PATH}' уже существует. Перезаписать его с нуля?"
            )
            if ask_confirm(prompt_text):
                write_data_js = True

        if write_data_js:
            final_settings = {
                "mouseViewMode": existing_settings.get("mouseViewMode", "drag"),
                "autorotateEnabled": existing_settings.get("autorotateEnabled", False),
                "tileFormat": selected_format["ext"]
            }
            data_js_content = {
                "scenes": all_scenes,
                "settings": final_settings
            }
            json_string = json.dumps(data_js_content, indent=2, ensure_ascii=False)
            with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
                f.write(f"var APP_DATA = {json_string};")
            print(f"Данные успешно обновлены в '{DATA_JS_PATH}'. Всего сцен в туре: {len(all_scenes)}.")
        else:
            print(f"Изменения в '{DATA_JS_PATH}' НЕ вносились.")
    elif tiles_folders:
        prompt_rebuild = (
            f"\nПапка '{OUTPUT_DIR}' уже содержит сцены ({len(tiles_folders)} шт.), но '{DATA_JS_PATH}' не найден. Создать его на основе структуры '{OUTPUT_DIR}'?"
            if not os.path.exists(DATA_JS_PATH) else
            f"\nНарезка не требовалась. Пересобрать '{DATA_JS_PATH}' на основе текущей структуры папки '{OUTPUT_DIR}' ({len(tiles_folders)} шт.)?"
        )
        if ask_confirm(prompt_rebuild):
            rebuilt_scenes, detected_ext = detect_tiles_structure(tiles_folders, existing_scenes, existing_settings)
            all_scenes = rebuild_all_hotspots(rebuilt_scenes)
            final_settings = {
                "mouseViewMode": existing_settings.get("mouseViewMode", "drag"),
                "autorotateEnabled": existing_settings.get("autorotateEnabled", False),
                "tileFormat": detected_ext
            }
            json_string = json.dumps({"scenes": all_scenes, "settings": final_settings}, indent=2, ensure_ascii=False)
            with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
                f.write(f"var APP_DATA = {json_string};")
            print(f"Файл '{DATA_JS_PATH}' успешно создан! Сцен: {len(all_scenes)}, формат тайлов: .{detected_ext}.")
        else:
            print("\nСкрипт успешно завершил работу без изменений.")
    else:
        print("\nНарезка не требовалась или выбор был отменен. Скрипт успешно завершил работу.")

if __name__ == "__main__":
    generate_tour()
