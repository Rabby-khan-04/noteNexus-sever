const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  ClientSession,
} = require("mongodb");
var jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// middleware
const corsOptions = {
  origin: "*",
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// Verify JWT
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(403)
      .send({ error: true, message: "Unauthorized Access" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.USER_ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "Unauthorized Access" });
    }
    req.decoded = decoded;
  });
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.loo5igw.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const database = client.db("noteNexus");
    const usersCollection = database.collection("user");
    const classCollection = database.collection("classes");
    const savedClassCollection = database.collection("savedClasses");
    const paymentHistry = database.collection("payments");

    // VerifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "Admin") {
        return res
          .status(403)
          .send({ error: true, message: "Unauthorized Access" });
      }
      next();
    };

    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "Instructor") {
        return res
          .status(403)
          .send({ error: true, message: "Unauthorized Access" });
      }
      next();
    };

    // Send User Token
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.USER_ACCESS_TOKEN, {
        expiresIn: "2h",
      });

      res.send({ token });
    });

    // Save User Info To DB
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const userInfo = req.body;
      const query = { email: email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.status(200).send({ message: "User Exist" });
      }
      userInfo.role = "Student";
      const options = { upsert: true };
      const updatedDoc = {
        $set: userInfo,
      };
      const result = await usersCollection.updateOne(
        query,
        updatedDoc,
        options
      );
      res.send(result);
    });

    // Get Use Role
    app.get("/user-role/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res
          .status(401)
          .send({ error: true, message: "Unauthorized Access" });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);

      const userRole = user?.role;
      res.send({ role: userRole });
    });

    // Get All Users
    app.get("/all-users/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Set User Role
    app.put("/set-role/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: role,
          enrolled: 0,
        },
      };
      const result = await usersCollection.updateOne(
        query,
        updatedDoc,
        options
      );
      res.send(result);
    });

    // Add Classes To Db
    app.post("/class", verifyJWT, verifyInstructor, async (req, res) => {
      const classInfo = req.body;
      const result = await classCollection.insertOne(classInfo);
      res.send(result);
    });

    // Get All Classes
    app.get("/classes", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await classCollection.find().toArray();
      res.send(result);
    });

    //Deny Class
    app.put("/class-deny/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { feedback } = req.body;
      const query = { _id: new ObjectId(id) };
      const option = { upsert: true };
      const upodateDoc = {
        $set: {
          feedback: feedback,
          status: "Denied",
        },
      };
      const result = await classCollection.updateOne(query, upodateDoc, option);
      res.send(result);
    });

    //Approve Class
    app.put("/class-approve/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const option = { upsert: true };
      const upodateDoc = {
        $set: {
          status: "Approved",
        },
      };
      const result = await classCollection.updateOne(query, upodateDoc, option);
      res.send(result);
    });

    // Get Instructors Classes
    app.get(
      "/my-classes/:email",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const result = await classCollection.find(query).toArray();
        res.send(result);
      }
    );

    // single Class
    app.get("/class/:id", verifyJWT, verifyInstructor, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classCollection.findOne(query);
      res.send(result);
    });

    // Update Class
    app.put("/class/:id", verifyJWT, verifyInstructor, async (req, res) => {
      const id = req.params.id;
      const classInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updetedDoc = {
        $set: classInfo,
        $unset: { feedback: 1 },
      };
      const result = await classCollection.updateOne(
        query,
        updetedDoc,
        options
      );
      res.send(result);
    });

    // Get Popular Classes
    app.get("/all-classes", async (req, res) => {
      const query = { status: "Approved" };
      const limit = parseInt(req.query.limit) || Infinity;
      const sort = { enroled: -1 };

      const result = await classCollection
        .find(query)
        .sort(sort)
        .limit(limit)
        .toArray();
      res.send(result);
    });

    // Select CLasses
    app.post("/select-class", verifyJWT, async (req, res) => {
      const bookinDetails = req.body;
      const query = {
        classId: bookinDetails?.classId,
        studentEmail: bookinDetails?.studentEmail,
      };
      const isExist = await savedClassCollection.findOne(query);
      if (isExist) {
        return res.send({
          exist: true,
          message: "This Class Is Already In Your Bookmark",
        });
      }
      const result = await savedClassCollection.insertOne(bookinDetails);
      res.send(result);
    });

    // Get Popular Instructors
    app.get("/instructors", async (req, res) => {
      const query = { role: "Instructor" };
      const limit = parseInt(req.query.limit) || Infinity;
      const sort = { enrolled: -1 };
      const result = await usersCollection
        .find(query)
        .sort(sort)
        .limit(limit)
        .toArray();
      res.send(result);
    });

    // Get Students Saved Class
    app.get("/saved-class", verifyJWT, async (req, res) => {
      const email = req.decoded.email;
      const query = { studentEmail: email };
      const result = await savedClassCollection.find(query).toArray();
      res.send(result);
    });

    // Delete Selected Class
    app.delete("/delete-class/:id", verifyJWT, async (req, res) => {
      const email = req.decoded.email;
      const id = req.params.id;
      const query = { studentEmail: email, _id: new ObjectId(id) };
      const result = await savedClassCollection.deleteOne(query);
      res.send(result);
    });

    // Signle Saved Class
    app.get("/saved-class/:id/payment", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const email = req.decoded.email;
      const query = { studentEmail: email, _id: new ObjectId(id) };
      const result = await savedClassCollection.findOne(query);
      res.send(result);
    });

    // create payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      if (!price) {
        return res.send({ error: true, message: "Unexped Error" });
      }
      const amount = price * 100;
      try {
        // Create a payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.log(error);
        res
          .status(500)
          .send({ error: true, message: "Payment Intent Creation Failed" });
      }
    });

    //Save Payment info
    app.post("/payment-histry", verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      const classId = paymentInfo.classId;
      const classQuery = { _id: new ObjectId(classId) };
      const instructorQuery = { email: paymentInfo.email };
      const updatedDoc = {
        $inc: { seats: -1, enroled: 1 },
      };
      const options = { returnOriginal: false };
      const updateClass = await classCollection.findOneAndUpdate(
        classQuery,
        updatedDoc,
        options
      );
      const updateTeacher = await usersCollection.findOneAndUpdate(
        instructorQuery,
        { $inc: { enrolled: 1 } },
        { upsert: true }
      );
      const result = await paymentHistry.insertOne(paymentInfo);
      res.send(result);
    });

    // Checking If the student already Enroled
    app.get("/cheking-histry", verifyJWT, async (req, res) => {
      const data = req.query;
      const query = { classId: data.id, studentEmail: data.email };
      const result = await paymentHistry.findOne(query);
      if (result) {
        res.send({ exist: true });
      } else {
        res.send({ exist: false });
      }
    });

    // Get All Users Payment Histry
    app.get("/payment-histry", verifyJWT, async (req, res) => {
      const email = req.decoded.email;
      const query = { studentEmail: email };
      const sort = { date: -1 };
      const result = await paymentHistry.find(query).sort(sort).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Note Nexus Server is running..");
});

app.listen(port, () => {
  console.log(`Note Nexus is running on port: ${port}`);
});
