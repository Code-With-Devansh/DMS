import express from 'express';
import authRouter from "./routes/auth.route.js"
import cookieParser from 'cookie-parser';


const app = express();
const port = 3000;

app.use(express.json());
app.use(cookieParser());


app.get('/', (req, res) => {
  res.send('Hello World!');
});


app.use("/api/auth", authRouter)

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});