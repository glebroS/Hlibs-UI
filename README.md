<div align="center">
  <h1> Hlibs-UI <br> <sub><em>Local LLM Interface for Ollama</em></sub></h1>
  <p>A high-end, premium web-based interface for your locally running AI models.</p>
  
  ![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
  ![Ollama](https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=Ollama&logoColor=white)

  <br><br>

  <img src="./assets/UI%20demo.gif" alt="Hlibs-UI Demo" width="800" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
</div>

<br>

> **A Note from the Author** 
> *This UI was created by me - **Hlib Potanin**. To be completely transparent: this interface is built to **make your eye happy**. If you're looking for absolute maximum model generation speed, using local models directly through your terminal will always be faster.* 
> 
> *That being said, I wanted to state my absolute amazement about the fact that we can run advanced LLMs entirely locally on our laptops. Welcome to the future!*

---

##  The Vision

Why use **Hlibs-UI**? This project drops the need for complex terminal interactions or clunky desktop clients, replacing them with a sleek, highly customizable chat interface right in your browser. 

We bring the power of your local models directly to a beautiful workspace tailored for everyday use.

##  Key Features

-  Reasoning Model Support (Chain-of-Thought): Automatically detects and neatly collapses `<think>` blocks (or other reasoning outputs) from advanced models into a dedicated logic panel. No more cluttered chats!
-  Vision Model Ready: Built-in drag-and-drop capability. Drop your images directly into the chat prompt and let your vision models analyze them instantly.
-  Precision Parameter Control: Tune your generations on the fly. Easily adjust advanced Ollama sampler settings including *Min-P, Mirostat, Seed, Temperature,* and *Top-K*.
-  Seamless Session State: Your chat history is persistently cached locally. Drop off anytime and pick your session up exactly where you left.
-  Markdown Export: Export your valuable chat sessions directly to clean Markdown files with a single click.

---

##  Architecture Under the Hood

The application splits its responsibilities perfectly between a lightweight backend and a robust frontend to maximize performance and security.

###  The Frontend (Client)
*The heavy lifter of model communication.*
Instead of proxying requests through the Express backend, the browser (`public/app.js`) makes **direct `fetch` calls** to your local instance of Ollama (`http://localhost:11434/api/chat`). It processes the incoming data stream, building out the DOM incrementally (without constant Markdown re-parsing overhead) to ensure buttery smooth text generation.

###  The Backend (Server)
*A straightforward `Node.js` Express server handling your local file system.*
- **Local Persistence:** Chat histories are stored as clean JSON files within the `conversations/` directory. REST APIs handle the CRUD operations.
- **Media Handling:** Uses `multer` to accept image uploads (routing them securely to `public/uploads`), passing them back as `base64` objects ready for your LLM.
- **Exporting:** Cleanly backs up your favorite chat sessions as `.md` files directly into `saved_outputs/`.

---

##  Getting Started

### Prerequisites
Before you begin, ensure you have the following installed on your machine:
* [**Node.js**](https://nodejs.org/) (for the backend server)
* [**Ollama**](https://ollama.com/) (actively running securely on port `11434`)

### Installation & Launch

1. **Clone the repository** to your local machine.
2. **Navigate** into the project directory:
   ```bash
   cd path/to/repo
   ```
3. **Install** the required Node dependencies:
   ```bash
   npm install
   ```
4. **Boot up** the application backend:
   ```bash
   npm start
   ```
5. **Launch** the UI by opening your favorite browser and navigating to:  
   **[http://localhost:3000](http://localhost:3000)**

---

##  Configuration Notes

- **Always verify** that Ollama is actively running in the background before submitting prompts.
- When the app starts, you can easily adjust your active model via the **left sidebar dropdown**. (It typically defaults to `gemma4:e4b` or a standard model depending on what you have pulled in Ollama).

---
<div align="center">
  <p>Crafted with heart by Hlib Potanin</p>
</div>
