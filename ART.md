# Game Art & Audio Provenance

- 날짜: 2026-07-19
- 게임: `grainsplit` (결 가르기)

이 게임의 화면은 두 종류로 나뉜다. 타이틀 카드 한 장만 이미지 생성 도구로 만들었고,
플레이 화면의 모든 픽셀은 런타임에서 절차적으로 그린다. 생성 이미지를 완성 UI로 쓰지 않는다.

## 생성 도구

- 도구: OpenAI Codex CLI의 내장 이미지 생성 도구(`image_gen`), `codex exec --sandbox workspace-write`로 비대화형 호출
- 실행 스크립트와 프롬프트 전문: `art/prompts/target-screens-pass1.sh`, `art/prompts/target-screens-pass2.sh`
- 생성 원본 PNG는 지우지 않고 `art/source/`와 `design/targets/`에 그대로 둔다.

## 타이틀 키 이미지

| 항목 | 값 |
| --- | --- |
| 원본 | `art/source/title-key.png` (1254x1254 PNG) |
| sha256 | `3cad85b107b30bf7ae2ad4b242ce6f0ae87a20d37fe9a1d77e93feb6accc75bb` |
| 게임에 실린 파일 | `public/art/title-key.jpg` |
| sha256 | `ff7246e4c2fe9d51b055a2b8f4b2fa267a9ea57f703e02ef8bfabada7ace90f5` |
| 후가공 | `sips -s format jpeg -s formatOptions 82 -Z 900` (긴 변 900px 리사이즈 + JPEG 82). 색과 구도 편집 없음 |
| 사용 위치 | 타이틀 카드 배경. `src/game/GrainsplitGame.ts`의 `titleKeyUrl()`이 로드하고 `drawOverlays()`가 그린다 |

프롬프트 요지: 해 질 녘 장작 마당, 요람에 얹힌 마른 활엽수 통나무, 나이테와 세로 섬유결,
박혀 있는 쇠쐐기와 결을 따라 벌어진 균열, 드러난 밝은 생재와 튀는 나뭇가루, 균열 앞에 칠해진
좁은 수액 그린 띠, 옆에 선 쐐기 세 개, 뒤에 쌓인 장작더미. 세피아 브라운과 크림으로 팔레트를
고정하고 그린은 띠에만. 사진처럼도 회화처럼도 아닌 절차적 2D 선화 톤. 전문은 위 스크립트에 있다.

## 앱 아이콘 / 파비콘

`public/icon-512.png`, `icon-192.png`, `apple-touch-icon.png`, `favicon-32.png`, `favicon-16.png`는
위 타이틀 키 원본을 중앙 1024 정사각으로 자른 뒤 `sips -Z <size>`로 축소한 것이다.
템플릿 기본 아이콘은 모두 교체했다.

- `public/icon-512.png` sha256 `5d15a51245b9f2180fe68a64d603fb980b65a6cf19aef33b26a617ce7d5c7089`

## 목표 화면 (design/targets)

GDD를 쓴 뒤 코드를 시작하기 전에 생성했다. 참고 기준이며 게임 자산으로 쓰지 않는다.

| 파일 | sha256 |
| --- | --- |
| `first-play.png` | `ae05f25947f9dde06abaa2e3c399b4591310214cb0f3cfd6dd21e88a1ff97e9a` |
| `verb-precise.png` | `8f8eba2fc9252060f70ebb14d6bb94ccf7053732e227cb0f9454c10fd793023b` |
| `verb-success.png` | `945202ce230c028ffb9fca44b3cabd54868d7f3f34fc4fd4571cd646ff4ed47e` |
| `verb-fail.png` | `75cddeac1edbd3df38b44adf39fba4151bfd08052880c191f8ac089e764a4609` |
| `game-over.png` | `a6f986ab8d85dd28555c57805a7503495d74c3888aba212a86c70ced69c9ae4b` |

1차 생성분은 통나무를 가로로 눕힌 것, 세로로 세운 것, 마구리면을 정면으로 본 것이 뒤섞여
같은 게임으로 읽히지 않았다. 그중 마구리면 정면 구도가 절차 그래픽으로 가장 정확히 재현되고
균열 진행과 목표 띠가 가장 잘 읽혀서, 그 구도로 프롬프트를 고정해 4장을 다시 생성했다
(`target-screens-pass2.sh`). `verb-success.png`만 1차 생성분을 그대로 쓴다.

## 플레이 화면의 게임 아트 (절차 생성, 이미지 없음)

`src/game/GrainsplitGame.ts`가 매 프레임 PixiJS Graphics로 그린다. 래스터 자산을 쓰지 않는다.

- 통나무 마구리면: 들쭉날쭉한 껍질 테두리, 변재와 심재 층, 5.5px 간격 나이테 타원(밴드의 결 편향만큼 휘어짐), 방사형 건조 균열, 결 벡터장을 따라 휘는 세로 섬유선
- 옹이: 동심 타원 다발과 어두운 심, 위아래로 흐르는 결 소용돌이. 균열이 지나면 꺾인다
- 목표 띠: 원 안쪽으로 클리핑한 수액 그린 가로 띠. 밴드마다 실제로 좁아진다
- 균열: 시드 고정 결 벡터장 위를 1/60초 스텝으로 걸어간 폴리라인. 벌어진 틈은 밝은 생재로 채우고 양 입술에 보풀 섬유를 그린다. 판정 등급이 폭을 정한다
- 쪼개짐: 균열선을 따라 자른 두 개의 마스크로 같은 마구리면을 두 번 보여 주며 좌우로 벌린다
- 산산조각: 중심에서 방사형으로 자른 쐐기꼴 파편이 회전하며 날아간다
- 나뭇가루: 판정에 관여하지 않는 비결정론 파티클
- 배경: 노을 그라디언트, 장작더미와 침엽수 실루엣, 흙바닥과 나무 부스러기
- 장작더미: 그 판에서 쪼갠 것과 망친 것을 형태로 구분해 왼쪽에 쌓는다. 지워지지 않는다
- 쐐기 세 개: 실패 예산. 부러지면 그루터기와 쓰러진 조각으로 형태가 바뀐다(색이 아니라 형태로 구분)

## 게임 사운드

`src/game/grainsplit/audio.ts`. WebAudio 합성만 쓴다. 오디오 파일 없음.
템플릿의 `public/audio/*.mp3`와 BGM 매니저는 제거했다.

- `sfxStrike(tier)`: 판정 등급이 음색으로 구분된다. 빗나감은 밝고 속 빈 금속 스침(1400Hz 사각파 + 2.6kHz 밴드패스 노이즈, 아래에 찢김 없음), 물림은 얕은 안착과 고르지 않은 섬유(190Hz 삼각파 + 900Hz 노이즈 220ms), 정타는 단단한 안착과 긴 찢김(150Hz + 1.25kHz 노이즈 340ms), 결은 가장 깊은 안착과 가장 긴 찢김(132Hz + 1.5kHz 노이즈 500ms)
- `sfxSplit`: 110Hz 하강 사인 + 2.2kHz 로우패스 노이즈
- `sfxShatter`: 광대역 노이즈 + 90Hz 톱니 + 다섯 개의 밴드패스 파편 소리
- `sfxWedgeSnap`: 880Hz 사각파 급하강 + 3.2kHz 고Q 노이즈
- `sfxEnd`: 220Hz와 146Hz 하강 톤

AudioContext는 첫 사용자 입력(`primaryInput`의 `sound.unlock()`) 뒤에만 만든다. 그 전에는 완전 무음이다.
음소거, 일시정지, 호스트 일시정지, 재시작에서 마스터 게인과 컨텍스트를 함께 제어한다.
소리에만 존재하는 신호는 없다. 모든 판정은 화면에서 먼저 읽힌다.

## 폰트

`public/fonts/Galmuri11.woff2`, `Galmuri11-Bold.woff2`, `Galmuri14.woff2` (템플릿 제공, 변경 없음).

## 공개용 라이카 일러스트

- 캐릭터 기준: `laika-base-v1`
- 베이스 SHA-256: `820e6d43e915c4e9e32ddcd3cc14d0f2537d99f6d8d397bbd40fc416137a6712`
- 생성 원본: `art/source/laika-grainsplit.png`
- 재현용 아트 디렉션: `art/prompts/laika-grainsplit.md`
- 해시와 검수: `art/provenance/laika-grainsplit.json`
- 웹 카드: `public/art/laika-grainsplit-640.jpg`
- 웹 상세: `public/art/laika-grainsplit-1280.jpg`

잠긴 대표 행동과 도구만 가져온다. 베이스 그림의 캡슐, 창, 지구, 팔레트를 게임 UI나 플레이 아트에 반영하지 않는다. 얼굴 무늬, 귀, 하네스, 주황 연결구, 발의 골격, 생성 문자, 모바일 크롭을 확인한다.

## 부록 · 공개 일러스트 생성 기록 (제작 잠금 뒤)

이 절은 게임 잠금 뒤 공개 서사 단계에서 추가했다. 게임 자산에는 영향을 주지 않는다.

| 항목 | 값 |
| --- | --- |
| 도구 | OpenAI Codex CLI 내장 `image_gen`, `codex exec --sandbox workspace-write -i <base>`로 비대화형 호출 |
| 정체성 참조 | `brand/art/laika-base.png` (`laika-base-v1`)를 실제 이미지 파일로 첨부. 텍스트 설명으로 대체하지 않음 |
| 참조 sha256 | `820e6d43e915c4e9e32ddcd3cc14d0f2537d99f6d8d397bbd40fc416137a6712` |
| 프롬프트 전문 | `art/prompts/laika-grainsplit.md` |
| 생성 원본 | `art/source/laika-grainsplit.png` (1024x1536 PNG) |
| 원본 sha256 | `14402e41fba8738b4f6a641671074ad254fb1f9b1313e0232a017291a07b4e2c` |
| 웹 카드 640 | `public/art/laika-grainsplit-640.jpg` sha256 `a230d151f5ef494962bad62144bc2da336faf1e12fad983f01414fefda70af13` |
| 웹 상세 1280 | `public/art/laika-grainsplit-1280.jpg` sha256 `02bb0fb95192afd88a4e85c55b464d9b119e8cd166af8f23d413adb3ae8e3307` |
| 후가공 | Pillow LANCZOS 비례 축소 + JPEG 변환(640은 품질 88, 1280은 90). 리터치, 색 보정, 합성 없음 |

잠긴 게임에서 가져온 것은 도구 하나(쇠쐐기)와 행동 하나(반동한 통나무 마구리면에 쐐기를 박아 넣는 것)뿐이다.
균열이 결을 따라 내려가고 입술에 찢긴 섬유와 밝은 생재가 드러나는 것까지가 그 행동의 결과다.

검수 결과는 `art/provenance/laika-grainsplit.json`의 `qa`에 있다. 얼굴 무늬와 귀, 흰 가슴과 앞발,
크림색 X자 하네스와 주황 연결구, 네 발 골격과 자연스러운 앞발, 생성 문자 없음, 모바일 정사각 크롭
모두 통과했다. 캡슐, 원형 창, 지구, 이 팔레트는 공개 일러스트에만 있고 게임 UI, 게임 아트,
게임 사운드로 되돌려 넣지 않았다.
